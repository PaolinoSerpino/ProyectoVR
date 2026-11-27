import * as THREE from 'three';
import { Hand } from '../vr/Hand.js';
import { INTERACTION } from '../config.js';

/**
 * ============================================================================
 * MODO PRUEBA PC (solo para debug sin casco). No se usa en sesiones WebXR.
 * ============================================================================
 * - Mouse: mirar (pointer lock) · WASD: moverse con colisión contra paredes.
 * - E: agarrar el objeto apuntado con la mira / soltarlo.
 * - Clic izq.: con martillo → martillazo animado (la mano se mueve de verdad, por lo que
 *   la velocidad del golpe la mide la misma física que en VR); con otro objeto → lanzarlo;
 *   sin nada → presionar botones 3D.
 * - L: volver al lobby.
 */
export class DesktopHand extends Hand {
  constructor(camera) {
    super('right');
    this.isDesktop = true;
    this.connected = true;
    this.camera = camera;
    camera.add(this.grip);
    this.attachGlove();
    this.rest = { pos: new THREE.Vector3(0.24, -0.25, -0.42), rot: new THREE.Euler(-0.15, 0.05, 0) };
    this.raised = { pos: new THREE.Vector3(0.27, 0.02, -0.24), rot: new THREE.Euler(0.95, 0.05, 0.1) };
    this.strike = { pos: new THREE.Vector3(0.16, -0.42, -0.66), rot: new THREE.Euler(-0.95, 0.02, -0.05) };
    this.swing = null;
    this.applyPose(this.rest.pos, this.rest.rot);
  }

  applyPose(pos, rot) {
    this.grip.position.copy(pos);
    this.grip.quaternion.setFromEuler(rot);
  }

  startSwing() {
    if (this.swing) return;
    this.swing = { t: 0 };
  }

  /** Animación de martillazo: impulso atrás (0.13 s) → golpe (0.2 s) → regreso (0.3 s). */
  animate(dt) {
    this.gripTarget = this.held ? 1 : 0;
    if (!this.swing) {
      this.applyPose(this.rest.pos, this.rest.rot);
      return;
    }
    const s = this.swing;
    s.t += dt;
    const lerpPose = (a, b, k) => {
      _p.lerpVectors(a.pos, b.pos, k);
      _qa.setFromEuler(a.rot);
      _qb.setFromEuler(b.rot);
      this.grip.position.copy(_p);
      this.grip.quaternion.slerpQuaternions(_qa, _qb, k);
    };
    const windup = 0.13, strike = 0.2, recover = 0.3;
    if (s.t < windup) {
      lerpPose(this.rest, this.raised, easeOut(s.t / windup));
    } else if (s.t < windup + strike) {
      lerpPose(this.raised, this.strike, easeInQuad((s.t - windup) / strike));
    } else if (s.t < windup + strike + recover) {
      lerpPose(this.strike, this.rest, easeInOut((s.t - windup - strike) / recover));
    } else {
      this.swing = null;
      this.applyPose(this.rest.pos, this.rest.rot);
    }
  }
}

const easeInQuad = (t) => t * t;
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const _p = new THREE.Vector3();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();

export class DesktopControls {
  constructor({ camera, rig, domElement, physics, grab, getInteractables, onBackToLobby }) {
    this.camera = camera;
    this.rig = rig;
    this.dom = domElement;
    this.physics = physics;
    this.grab = grab;
    this.getInteractables = getInteractables;
    this.onBackToLobby = onBackToLobby;
    this.enabled = false;
    this.keys = new Set();
    this.yaw = 0;
    this.pitch = 0;
    this.hand = new DesktopHand(camera);
    this.raycaster = new THREE.Raycaster();
    this.hand.grip.visible = false;

    this.onMouseMove = (e) => {
      if (!this.enabled || document.pointerLockElement !== this.dom) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * 0.0022, -1.45, 1.45);
    };
    this.onMouseDown = (e) => {
      if (!this.enabled) return;
      if (document.pointerLockElement !== this.dom) {
        this.dom.requestPointerLock();
        return;
      }
      if (e.button === 0) this.primaryAction();
    };
    this.onKeyDown = (e) => {
      if (!this.enabled) return;
      this.keys.add(e.code);
      if (e.code === 'KeyE') this.toggleGrab();
      if (e.code === 'KeyL') this.onBackToLobby?.();
    };
    this.onKeyUp = (e) => this.keys.delete(e.code);
    // Si se pierde el foco o el pointer lock, el keyup nunca llega: evitar teclas "pegadas"
    this.clearKeys = () => this.keys.clear();

    window.addEventListener('mousemove', this.onMouseMove);
    this.dom.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.clearKeys);
    document.addEventListener('visibilitychange', this.clearKeys);
    document.addEventListener('pointerlockchange', this.clearKeys);
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    this.hand.grip.visible = enabled;
    document.getElementById('crosshair').style.display = enabled ? 'block' : 'none';
    document.getElementById('desktop-help').style.display = enabled ? 'block' : 'none';
    if (enabled) {
      this.camera.position.set(0, 1.6, 0);
      this.yaw = this.rig.rotation.y;
      this.pitch = 0;
    } else if (document.pointerLockElement === this.dom) {
      document.exitPointerLock();
    }
  }

  /** Alinea la vista con el yaw del rig tras un cambio de escena. */
  syncFromRig() {
    this.yaw = this.rig.rotation.y;
    this.pitch = 0;
  }

  getViewRay(origin, direction) {
    this.camera.getWorldPosition(origin);
    this.camera.getWorldDirection(direction);
  }

  primaryAction() {
    const held = this.hand.held;
    if (held?.userData.isHammer) {
      this.hand.startSwing();
      return;
    }
    if (held) {
      // Lanzamiento de prueba: dirección de la mira con un arco leve
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      const velocity = dir.multiplyScalar(9.5).add(new THREE.Vector3(0, 1.4, 0));
      const angular = new THREE.Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
      this.grab.release(this.hand, { velocity, angular });
      return;
    }
    // Botones 3D bajo la mira
    const origin = new THREE.Vector3(), dir = new THREE.Vector3();
    this.getViewRay(origin, dir);
    this.raycaster.set(origin, dir);
    this.raycaster.far = 3.2;
    const targets = this.getInteractables().map((b) => b.cap);
    const hit = this.raycaster.intersectObjects(targets, false)[0];
    if (hit) hit.object.userData.interactable.pressFromDesktop();
  }

  toggleGrab() {
    if (this.hand.held) {
      this.grab.release(this.hand);
      return;
    }
    const origin = new THREE.Vector3(), dir = new THREE.Vector3();
    this.getViewRay(origin, dir);
    const hit = this.physics.castRay(origin, dir, INTERACTION.desktopReach, (obj) => this.grab.isGrabbable(obj));
    if (hit?.object) this.grab.tryGrab(this.hand, hit.object);
  }

  update(dt) {
    if (!this.enabled) return;
    this.rig.rotation.y = this.yaw;
    this.camera.rotation.set(this.pitch, 0, 0, 'YXZ');

    // Movimiento WASD con colisión contra la arquitectura estática
    const move = new THREE.Vector3(
      (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0),
      0,
      (this.keys.has('KeyS') ? 1 : 0) - (this.keys.has('KeyW') ? 1 : 0)
    );
    if (move.lengthSq() > 0) {
      move.normalize().applyAxisAngle(_yAxis, this.yaw).multiplyScalar(2.4 * dt);
      const head = new THREE.Vector3();
      this.camera.getWorldPosition(head);
      head.y -= 0.6;
      const dist = move.length();
      const hit = this.physics.castRay(head, move.clone().normalize(), dist + 0.35, (obj) => obj?.isStatic);
      if (!hit) this.rig.position.add(move);
    }

    this.hand.animate(dt);
    this.hand.updateTracking(dt);
  }
}

const _yAxis = new THREE.Vector3(0, 1, 0);
