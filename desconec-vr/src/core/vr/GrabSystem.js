import * as THREE from 'three';
import { GROUP, PHYSICS, INTERACTION, ALL_GROUPS } from '../config.js';

/**
 * Sistema de agarre físico (Grab & Throw) basado en seguimiento por velocidad:
 * el objeto agarrado sigue siendo un cuerpo DINÁMICO (gravedad 0) al que en cada subpaso
 * se le asigna la velocidad lineal/angular necesaria para alcanzar la pose de la mano.
 * Así conserva colisiones reales con masa, CCD activo (el martillo nunca atraviesa un monitor)
 * y al soltarlo hereda la velocidad lineal + angular real de la mano (v + ω × r).
 *
 * Perfil de agarre opcional (userData.grabProfile):
 *  - snap: { position: Vector3, quaternion: Quaternion } → pose fija en la mano (martillo ergonómico)
 *  - sinó: agarre natural que conserva el offset del momento en que se tomó.
 */
export class GrabSystem {
  constructor({ physics, audio }) {
    this.physics = physics;
    this.audio = audio;
    this.hands = [];
    this.holds = new Map();
    this.listeners = { grab: new Set(), release: new Set() };
    physics.onPreStep((h, t) => this.preStep(h, t));
  }

  on(type, fn) {
    this.listeners[type].add(fn);
    return () => this.listeners[type].delete(fn);
  }

  emit(type, payload) {
    this.listeners[type].forEach((fn) => fn(payload));
  }

  addHand(hand) {
    this.hands.push(hand);
    hand.onGrabDown = () => this.tryGrab(hand);
    hand.onGrabUp = () => this.release(hand);
  }

  isGrabbable(obj) {
    return !!obj && obj.alive && obj.userData.grabbable && !obj.userData.locked;
  }

  /** Busca el objeto agarrable más cercano a la palma (o el que indique la mano de PC). */
  findTarget(hand) {
    if (hand.findGrabTarget) return hand.findGrabTarget(this);
    const point = hand.getGrabPoint(_v1);
    const hit = this.physics.nearestObject(point, INTERACTION.grabRadius, (o) => this.isGrabbable(o));
    return hit ? hit.object : null;
  }

  tryGrab(hand, forcedObject = null) {
    if (this.holds.has(hand)) return;
    const obj = forcedObject || this.findTarget(hand);
    if (!obj) {
      hand.pulse(0.08, 15);
      return;
    }
    // Pasar de una mano a la otra
    for (const [otherHand, hold] of this.holds) {
      if (hold.object === obj) this.release(otherHand, { silent: true, zeroVelocity: true });
    }

    hand.grip.updateWorldMatrix(true, false);
    const handMatrix = hand.grip.matrixWorld;
    const offset = new THREE.Matrix4();
    const profile = obj.userData.grabProfile;
    if (profile?.snap) {
      offset.compose(profile.snap.position, profile.snap.quaternion, _one);
    } else if (hand.isDesktop) {
      // En PC el objeto viaja a la mano conservando su orientación relativa
      const handQuat = _q1.setFromRotationMatrix(handMatrix);
      const rel = handQuat.clone().invert().multiply(_q2.copy(obj.currQuat));
      offset.compose(new THREE.Vector3(0, 0, -0.06), rel, _one);
    } else {
      const objMatrix = new THREE.Matrix4().compose(obj.currPos, obj.currQuat, _one);
      offset.copy(handMatrix).invert().multiply(objMatrix);
    }

    const body = obj.body;
    const hold = {
      object: obj,
      hand,
      offset,
      prevTarget: new THREE.Matrix4(),
      currTarget: new THREE.Matrix4(),
      grabTime: performance.now(),
      ccdBefore: body.isCcdEnabled(),
      pullDistance: 0
    };
    this.computeTarget(hold, hold.currTarget);
    hold.prevTarget.copy(hold.currTarget);
    hold.pullDistance = _v2.setFromMatrixPosition(hold.currTarget).distanceTo(obj.currPos);

    body.setGravityScale(0, true);
    body.enableCcd(true);
    body.wakeUp();
    this.physics.setGroups(obj, GROUP.HELD, ALL_GROUPS & ~GROUP.HELD);

    obj.userData.heldBy = hand;
    hand.held = obj;
    this.holds.set(hand, hold);

    hand.pulse(0.35, 35);
    this.audio?.play('grab', obj.currPos, { intensity: 0.4 });
    this.emit('grab', { object: obj, hand });
  }

  /**
   * Suelta el objeto. Por defecto hereda la velocidad real de la mano:
   *   v = v_mano(pico suavizado) + ω_mano × (COM_objeto − posición_mano)
   * options.velocity / options.angular permiten forzar valores (modo PC).
   */
  release(hand, options = {}) {
    const hold = this.holds.get(hand);
    if (!hold) return;
    this.holds.delete(hand);
    const obj = hold.object;
    hand.held = null;
    if (!obj.alive) return;

    const body = obj.body;
    body.setGravityScale(1, true);
    body.enableCcd(hold.ccdBefore || obj.userData.alwaysCcd === true);
    this.physics.setGroups(obj, obj.userData.group ?? GROUP.DEVICE);
    obj.userData.heldBy = null;

    const lin = new THREE.Vector3();
    const ang = new THREE.Vector3();
    if (options.zeroVelocity) {
      // sin velocidad
    } else if (options.velocity) {
      lin.copy(options.velocity);
      if (options.angular) ang.copy(options.angular);
    } else {
      hand.tracker.getThrowVelocity(lin, ang);
      const com = body.worldCom();
      const r = _v1.set(com.x, com.y, com.z).sub(hand.worldPos);
      lin.add(_v2.copy(ang).cross(r));
    }
    if (lin.length() > PHYSICS.maxTrackingSpeed) lin.setLength(PHYSICS.maxTrackingSpeed);
    body.setLinvel(lin, true);
    body.setAngvel(ang, true);

    const speed = lin.length();
    if (!options.silent) {
      hand.pulse(Math.min(0.6, 0.1 + speed * 0.05), 25);
      if (speed > 3) this.audio?.play('whoosh', obj.currPos, { intensity: Math.min(1, speed / 12) });
    }
    this.emit('release', { object: obj, hand, velocity: lin.clone(), speed, position: obj.currPos.clone() });
  }

  releaseAll() {
    [...this.holds.keys()].forEach((hand) => this.release(hand, { silent: true, zeroVelocity: true }));
  }

  /** Suelta si el objeto pertenece a una escena que se desmonta o fue destruido. */
  forget(obj) {
    for (const [hand, hold] of this.holds) {
      if (hold.object === obj) {
        this.holds.delete(hand);
        hand.held = null;
      }
    }
  }

  computeTarget(hold, out) {
    hold.hand.grip.updateWorldMatrix(true, false);
    return out.multiplyMatrices(hold.hand.grip.matrixWorld, hold.offset);
  }

  /** Por frame (antes de los subpasos): registra la nueva pose objetivo de cada mano. */
  update() {
    for (const [, hold] of this.holds) {
      if (!hold.object.alive) continue;
      hold.prevTarget.copy(hold.currTarget);
      this.computeTarget(hold, hold.currTarget);
    }
  }

  /** Tras teletransporte/giro: los objetos en mano se mueven con el jugador sin generar velocidades. */
  onRigMoved() {
    for (const [hand, hold] of this.holds) {
      hand.tracker.reset();
      this.computeTarget(hold, hold.currTarget);
      hold.prevTarget.copy(hold.currTarget);
      const p = new THREE.Vector3(), q = new THREE.Quaternion();
      hold.currTarget.decompose(p, q, _s);
      this.placeBodyAtTarget(hold.object, p, q);
    }
    this.hands.forEach((h) => h.tracker.reset());
  }

  placeBodyAtTarget(obj, originPos, quat) {
    obj.body.setTranslation(originPos, true);
    obj.body.setRotation(quat, true);
    obj.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    obj.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    obj.snap();
  }

  /** Subpaso de física: velocidad necesaria para llegar a la pose objetivo interpolada. */
  preStep(h, t) {
    for (const [, hold] of this.holds) {
      const obj = hold.object;
      if (!obj.alive) continue;
      const body = obj.body;

      hold.prevTarget.decompose(_pA, _qA, _s);
      hold.currTarget.decompose(_pB, _qB, _s);
      _pA.lerp(_pB, t);
      _qA.slerp(_qB, t);

      // Angular: q_err = q_obj⁻¹ aplicado → ω = eje·ángulo / h
      const r = body.rotation();
      _q1.set(r.x, r.y, r.z, r.w);
      _q2.copy(_qA).multiply(_q1.invert());
      if (_q2.w < 0) { _q2.x = -_q2.x; _q2.y = -_q2.y; _q2.z = -_q2.z; _q2.w = -_q2.w; }
      const angle = 2 * Math.acos(Math.min(1, _q2.w));
      const s = Math.sqrt(Math.max(0, 1 - _q2.w * _q2.w));
      if (s < 1e-6) _w.set(0, 0, 0);
      else _w.set(_q2.x / s, _q2.y / s, _q2.z / s).multiplyScalar(angle / h);
      if (_w.length() > PHYSICS.maxTrackingAngular) _w.setLength(PHYSICS.maxTrackingAngular);

      // Lineal: el objetivo es el ORIGEN del cuerpo; Rapier integra la velocidad del centro de masa:
      // v_com = v_origen − ω × (origen − com)
      const tr = body.translation();
      _v1.set(_pA.x - tr.x, _pA.y - tr.y, _pA.z - tr.z).divideScalar(h);
      const com = body.worldCom();
      _v2.set(tr.x - com.x, tr.y - com.y, tr.z - com.z);
      _v1.sub(_v3.copy(_w).cross(_v2));

      // En PC, el objeto "vuela" a la mano a velocidad moderada durante el primer tramo
      let maxSpeed = PHYSICS.maxTrackingSpeed;
      if (hold.hand.isDesktop && performance.now() - hold.grabTime < 450) maxSpeed = 7;
      if (_v1.length() > maxSpeed) _v1.setLength(maxSpeed);

      body.setLinvel(_v1, true);
      body.setAngvel(_w, true);
    }
  }
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _w = new THREE.Vector3();
const _pA = new THREE.Vector3();
const _pB = new THREE.Vector3();
const _qA = new THREE.Quaternion();
const _qB = new THREE.Quaternion();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
