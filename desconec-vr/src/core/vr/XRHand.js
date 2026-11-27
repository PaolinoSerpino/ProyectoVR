import * as THREE from 'three';
import { Hand } from './Hand.js';

/**
 * Mano WebXR asociada a un input source (mando con grip/squeeze o mano con hand-tracking).
 * - Grip / Squeeze → agarrar. En hand-tracking el gesto de pinza (select) también agarra.
 * - Velocidades: usa `pose.linearVelocity/angularVelocity` del visor si existen
 *   (transformadas del espacio de referencia al mundo del rig); si no, deltas reales por frame.
 */
export class XRHand extends Hand {
  constructor(renderer, index, rig) {
    super(index === 0 ? 'left' : 'right');
    this.index = index;
    this.rig = rig;
    this.inputSource = null;
    this.grip = renderer.xr.getControllerGrip(index);
    this.targetRay = renderer.xr.getController(index);
    rig.add(this.grip, this.targetRay);
    this.gripPressed = false;
    this.poseLinear = new THREE.Vector3();
    this.poseAngular = new THREE.Vector3();
    this.hasPoseVelocity = false;

    this.grip.addEventListener('connected', (e) => {
      this.inputSource = e.data;
      this.handedness = e.data.handedness || this.handedness;
      this.connected = true;
      this.tracker.reset();
      if (!this.glove) this.attachGlove();
      this.glove.root.visible = true;
    });
    this.grip.addEventListener('disconnected', () => {
      if (this.held) this.onGrabUp?.(this);
      this.connected = false;
      this.inputSource = null;
      if (this.glove) this.glove.root.visible = false;
    });

    const down = () => {
      if (this.gripPressed) return;
      this.gripPressed = true;
      this.gripTarget = 1;
      this.onGrabDown?.(this);
    };
    const up = () => {
      if (!this.gripPressed) return;
      this.gripPressed = false;
      this.gripTarget = 0;
      this.onGrabUp?.(this);
    };
    this.grip.addEventListener('squeezestart', down);
    this.grip.addEventListener('squeezeend', up);
    this.targetRay.addEventListener('squeezestart', down);
    this.targetRay.addEventListener('squeezeend', up);
    this.targetRay.addEventListener('selectstart', () => { if (this.inputSource?.hand) down(); });
    this.targetRay.addEventListener('selectend', () => { if (this.inputSource?.hand) up(); });
  }

  /** Lee velocidades nativas del frame XR (si el visor las provee). */
  readPoseVelocity(frame, referenceSpace) {
    this.hasPoseVelocity = false;
    if (!frame || !this.inputSource?.gripSpace || !referenceSpace) return;
    const pose = frame.getPose(this.inputSource.gripSpace, referenceSpace);
    if (!pose || !pose.linearVelocity || !pose.angularVelocity) return;
    const rigQuat = this.rig.getWorldQuaternion(_q);
    this.poseLinear.set(pose.linearVelocity.x, pose.linearVelocity.y, pose.linearVelocity.z).applyQuaternion(rigQuat);
    this.poseAngular.set(pose.angularVelocity.x, pose.angularVelocity.y, pose.angularVelocity.z).applyQuaternion(rigQuat);
    this.hasPoseVelocity = true;
  }

  update(dt, frame, referenceSpace) {
    if (!this.connected) return;
    this.readPoseVelocity(frame, referenceSpace);
    this.updateTracking(dt, this.hasPoseVelocity ? this.poseLinear : null, this.hasPoseVelocity ? this.poseAngular : null);
  }

  get gamepad() {
    return this.inputSource?.gamepad || null;
  }

  /** Joystick (xr-standard: ejes 2/3; fallback 0/1 para touchpads). */
  getStick(out = new THREE.Vector2()) {
    const gp = this.gamepad;
    if (!gp || !gp.axes) return out.set(0, 0);
    const x = gp.axes.length >= 4 ? gp.axes[2] : gp.axes[0] || 0;
    const y = gp.axes.length >= 4 ? gp.axes[3] : gp.axes[1] || 0;
    return out.set(x, y);
  }

  /** Botón A/X (4) o B/Y (5) del mapping xr-standard. */
  isButtonPressed(index) {
    return !!this.gamepad?.buttons?.[index]?.pressed;
  }

  /** Vibración proporcional (0..1) en la mano correspondiente. */
  pulse(intensity, durationMs) {
    const gp = this.gamepad;
    if (!gp) return;
    const value = Math.min(1, Math.max(0, intensity));
    const actuator = gp.hapticActuators?.[0];
    if (actuator?.pulse) {
      actuator.pulse(value, durationMs);
    } else if (gp.vibrationActuator?.playEffect) {
      gp.vibrationActuator.playEffect('dual-rumble', { duration: durationMs, strongMagnitude: value, weakMagnitude: value * 0.6 }).catch(() => {});
    }
  }
}

const _q = new THREE.Quaternion();
