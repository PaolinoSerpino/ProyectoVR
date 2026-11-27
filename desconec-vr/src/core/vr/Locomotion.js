import * as THREE from 'three';
import { INTERACTION, PALETTE } from '../config.js';

/**
 * Locomoción sin teclado para cascos VR:
 *  - Joystick hacia adelante: aparece un arco parabólico desde el mando; al soltar el stick
 *    se teletransporta al punto de aterrizaje si es piso válido (normal hacia arriba + área de la escena).
 *  - Joystick izquierda/derecha: giro por pasos (snap turn) de 30° alrededor de la cabeza.
 */
export class Locomotion {
  constructor({ rig, physics, getHeadPosition, onMoved }) {
    this.rig = rig;
    this.physics = physics;
    this.getHeadPosition = getHeadPosition;
    this.onMoved = onMoved;
    this.isTeleportable = () => true;
    this.aiming = null;
    this.snapArmed = new Map();
    this.validTarget = null;

    const arcPoints = 48;
    this.arcGeometry = new THREE.BufferGeometry();
    this.arcGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(arcPoints * 3), 3));
    this.arcLine = new THREE.Line(this.arcGeometry, new THREE.LineBasicMaterial({ color: 0x9ed4a8, transparent: true, opacity: 0.9 }));
    this.arcLine.frustumCulled = false;
    this.arcLine.visible = false;
    this.arcPoints = arcPoints;

    this.reticle = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.27, 40),
      new THREE.MeshBasicMaterial({ color: 0x9ed4a8, transparent: true, opacity: 0.95, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.22, 40),
      new THREE.MeshBasicMaterial({ color: PALETTE.forest, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
    );
    disc.rotation.x = -Math.PI / 2;
    this.reticle.add(ring, disc);
    this.reticle.visible = false;
    this.reticleRing = ring;
  }

  attach(scene) {
    scene.add(this.arcLine, this.reticle);
  }

  setTeleportFilter(fn) {
    this.isTeleportable = fn || (() => true);
  }

  update(dt, xrHands) {
    for (const hand of xrHands) {
      if (!hand.connected) continue;
      const stick = hand.getStick(_stick);

      // --- Teletransporte (stick adelante) ---
      if (this.aiming === hand) {
        if (stick.y > -0.35) {
          if (this.validTarget) this.teleportTo(this.validTarget);
          this.aiming = null;
          this.hideArc();
        } else {
          this.updateArc(hand);
        }
      } else if (!this.aiming && stick.y < -0.7 && Math.abs(stick.x) < 0.6) {
        this.aiming = hand;
      }

      // --- Giro por pasos (stick lateral) ---
      const armed = this.snapArmed.get(hand) ?? true;
      if (armed && Math.abs(stick.x) > 0.75 && this.aiming !== hand) {
        this.snapTurn(-Math.sign(stick.x));
        this.snapArmed.set(hand, false);
        hand.pulse(0.15, 20);
      } else if (Math.abs(stick.x) < 0.3) {
        this.snapArmed.set(hand, true);
      }
    }
  }

  updateArc(hand) {
    hand.targetRay.updateWorldMatrix(true, false);
    const origin = _o.setFromMatrixPosition(hand.targetRay.matrixWorld);
    const dir = _d.set(0, 0, -1).applyQuaternion(_q.setFromRotationMatrix(hand.targetRay.matrixWorld)).normalize();
    const velocity = _vel.copy(dir).multiplyScalar(7.5);
    const g = -9.8;
    const pos = this.arcGeometry.attributes.position;
    const dtStep = 0.035;
    let landed = null;
    let lastIndex = this.arcPoints - 1;
    const prev = _p0.copy(origin);

    for (let i = 0; i < this.arcPoints; i++) {
      const t = i * dtStep;
      const p = _p1.set(origin.x + velocity.x * t, origin.y + velocity.y * t + 0.5 * g * t * t, origin.z + velocity.z * t);
      if (i > 0 && !landed) {
        const seg = _seg.copy(p).sub(prev);
        const len = seg.length();
        if (len > 1e-4) {
          const hit = this.physics.castRay(prev, seg.divideScalar(len), len, (obj) => obj?.isStatic);
          if (hit) {
            p.copy(hit.point);
            const floorLike = hit.normal.y > 0.75;
            const dist = _flat.set(hit.point.x - origin.x, 0, hit.point.z - origin.z).length();
            landed = floorLike && dist < INTERACTION.teleportMaxDistance && this.isTeleportable(hit.point) ? hit.point.clone() : 'invalid';
            lastIndex = i;
          }
        }
      }
      if (landed && i > lastIndex) p.copy(prev);
      pos.setXYZ(i, p.x, p.y, p.z);
      prev.copy(p);
    }
    pos.needsUpdate = true;
    this.arcLine.visible = true;

    const valid = landed && landed !== 'invalid';
    this.validTarget = valid ? landed : null;
    this.arcLine.material.color.set(valid ? 0x9ed4a8 : 0xd9534f);
    this.reticle.visible = !!valid;
    if (valid) {
      this.reticle.position.copy(landed).add(_up);
      this.reticleRing.scale.setScalar(1 + Math.sin(performance.now() * 0.01) * 0.06);
    }
  }

  hideArc() {
    this.arcLine.visible = false;
    this.reticle.visible = false;
    this.validTarget = null;
  }

  /** Mueve el rig para que la CABEZA quede sobre el punto (respeta la posición física en el cuarto). */
  teleportTo(point) {
    const head = this.getHeadPosition(_head);
    this.rig.position.x += point.x - head.x;
    this.rig.position.z += point.z - head.z;
    this.rig.position.y = point.y;
    this.rig.updateMatrixWorld(true);
    this.onMoved?.('teleport');
  }

  snapTurn(direction) {
    const angle = THREE.MathUtils.degToRad(INTERACTION.snapTurnDegrees) * direction;
    const head = this.getHeadPosition(_head);
    const offset = _off.copy(this.rig.position).sub(head);
    offset.applyAxisAngle(_yAxis, angle);
    this.rig.position.copy(head).add(offset);
    this.rig.rotation.y += angle;
    this.rig.updateMatrixWorld(true);
    this.onMoved?.('turn');
  }
}

const _stick = new THREE.Vector2();
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _vel = new THREE.Vector3();
const _p0 = new THREE.Vector3();
const _p1 = new THREE.Vector3();
const _seg = new THREE.Vector3();
const _flat = new THREE.Vector3();
const _head = new THREE.Vector3();
const _off = new THREE.Vector3();
const _up = new THREE.Vector3(0, 0.01, 0);
const _yAxis = new THREE.Vector3(0, 1, 0);
