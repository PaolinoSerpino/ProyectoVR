import * as THREE from 'three';
import { VelocityTracker } from './VelocityTracker.js';
import { PALETTE } from '../config.js';

/**
 * Mano abstracta compartida por WebXR y por el modo de prueba de PC.
 * GrabSystem y los minijuegos solo hablan con esta interfaz:
 *  - `grip` (Object3D) define la pose de sujeción en mundo.
 *  - `tracker` guarda velocidades reales lineales/angulares.
 *  - `onGrabDown` / `onGrabUp` los asigna GrabSystem.
 *  - `pulse()` vibración háptica proporcional.
 */
export class Hand {
  constructor(handedness) {
    this.handedness = handedness;
    this.grip = new THREE.Object3D();
    this.tracker = new VelocityTracker();
    this.held = null;
    this.connected = false;
    this.isDesktop = false;
    this.onGrabDown = null;
    this.onGrabUp = null;
    this.worldPos = new THREE.Vector3();
    this.worldQuat = new THREE.Quaternion();
    this.glove = null;
    this.gripAmount = 0;
    this.gripTarget = 0;
  }

  /** Punto de agarre: un poco por delante de la palma (espacio mundo). */
  getGrabPoint(out = new THREE.Vector3()) {
    return out.set(0, -0.01, -0.04).applyMatrix4(this.grip.matrixWorld);
  }

  /** Actualiza pose mundo + buffer de velocidades. Las subclases pueden pasar velocidades nativas. */
  updateTracking(dt, poseLinear = null, poseAngular = null) {
    this.grip.updateWorldMatrix(true, false);
    this.grip.matrixWorld.decompose(this.worldPos, this.worldQuat, _scale);
    this.tracker.push(this.worldPos, this.worldQuat, dt, poseLinear, poseAngular);
    // Animación del guante: cierre suave al apretar el grip
    this.gripAmount += (this.gripTarget - this.gripAmount) * Math.min(1, dt * 18);
    if (this.glove) this.glove.setClosed(this.gripAmount);
  }

  pulse(_intensity, _durationMs) {}

  attachGlove() {
    this.glove = new Glove(this.handedness);
    this.grip.add(this.glove.root);
  }
}

const _scale = new THREE.Vector3();

/**
 * Guante low-poly articulado (palma + 4 dedos de 2 falanges + pulgar).
 * Se dibuja en el espacio del grip: dedos hacia -Z, dorso hacia +Y.
 */
export class Glove {
  constructor(handedness) {
    const side = handedness === 'left' ? -1 : 1;
    this.root = new THREE.Group();
    this.fingers = [];
    const skin = new THREE.MeshStandardMaterial({ color: PALETTE.forest, roughness: 0.7, metalness: 0.05 });
    const cuff = new THREE.MeshStandardMaterial({ color: PALETTE.botanicalDark, roughness: 0.8 });

    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.026, 0.085), skin);
    palm.position.set(0, 0, 0.02);
    palm.castShadow = true;
    this.root.add(palm);

    const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.034, 0.05, 12), cuff);
    wrist.rotation.x = Math.PI / 2;
    wrist.position.set(0, 0, 0.085);
    this.root.add(wrist);

    const fingerGeo1 = new THREE.BoxGeometry(0.016, 0.018, 0.04);
    const fingerGeo2 = new THREE.BoxGeometry(0.015, 0.016, 0.032);
    fingerGeo1.translate(0, 0, -0.02);
    fingerGeo2.translate(0, 0, -0.016);
    [-0.027, -0.009, 0.009, 0.027].forEach((x, i) => {
      const base = new THREE.Group();
      base.position.set(x, 0, -0.022 + (i === 0 || i === 3 ? 0.006 : 0));
      const p1 = new THREE.Mesh(fingerGeo1, skin);
      const joint = new THREE.Group();
      joint.position.z = -0.04;
      const p2 = new THREE.Mesh(fingerGeo2, skin);
      p1.castShadow = p2.castShadow = true;
      joint.add(p2);
      base.add(p1, joint);
      this.root.add(base);
      this.fingers.push({ base, joint });
    });

    const thumbBase = new THREE.Group();
    thumbBase.position.set(0.04 * side * -1, -0.004, 0.02);
    thumbBase.rotation.y = 0.7 * side * -1;
    const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.018, 0.045), skin);
    thumb.position.z = -0.022;
    thumbBase.add(thumb);
    this.root.add(thumbBase);
    this.thumb = thumbBase;
    this.side = side;

    // Leve inclinación natural respecto del mando
    this.root.rotation.x = -0.35;
    this.setClosed(0);
  }

  setClosed(t) {
    this.fingers.forEach(({ base, joint }) => {
      base.rotation.x = -t * 1.25;
      joint.rotation.x = -t * 1.35;
    });
    this.thumb.rotation.x = -t * 0.6;
  }
}
