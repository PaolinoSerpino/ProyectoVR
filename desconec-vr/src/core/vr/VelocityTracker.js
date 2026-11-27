import * as THREE from 'three';
import { INTERACTION } from '../config.js';

/**
 * Buffer circular de velocidades reales de una mano/mando (espacio mundo).
 * - Lineal: delta de posición / dt, o `pose.linearVelocity` si el visor la provee.
 * - Angular: delta de rotación (q_actual * q_anterior⁻¹ → eje·ángulo / dt), o `pose.angularVelocity`.
 * Se guardan los últimos N frames para suavizar y para detectar el pico del lanzamiento.
 */
export class VelocityTracker {
  constructor(size = INTERACTION.velocitySamples) {
    this.size = size;
    this.linear = Array.from({ length: size }, () => new THREE.Vector3());
    this.angular = Array.from({ length: size }, () => new THREE.Vector3());
    this.count = 0;
    this.index = 0;
    this.lastPos = new THREE.Vector3();
    this.lastQuat = new THREE.Quaternion();
    this.hasLast = false;
    this._q = new THREE.Quaternion();
  }

  reset() {
    this.count = 0;
    this.index = 0;
    this.hasLast = false;
    this.linear.forEach((v) => v.set(0, 0, 0));
    this.angular.forEach((v) => v.set(0, 0, 0));
  }

  /**
   * @param {THREE.Vector3} pos posición mundo actual
   * @param {THREE.Quaternion} quat rotación mundo actual
   * @param {number} dt segundos desde el frame anterior
   * @param {THREE.Vector3|null} poseLinear velocidad lineal nativa del visor (ya en mundo) o null
   * @param {THREE.Vector3|null} poseAngular velocidad angular nativa del visor (ya en mundo) o null
   */
  push(pos, quat, dt, poseLinear = null, poseAngular = null) {
    if (!this.hasLast || dt <= 0) {
      this.lastPos.copy(pos);
      this.lastQuat.copy(quat);
      this.hasLast = true;
      return;
    }
    const lin = this.linear[this.index];
    const ang = this.angular[this.index];

    if (poseLinear) lin.copy(poseLinear);
    else lin.copy(pos).sub(this.lastPos).divideScalar(dt);

    if (poseAngular) {
      ang.copy(poseAngular);
    } else {
      const dq = this._q.copy(quat).multiply(this.lastQuat.clone().invert());
      if (dq.w < 0) { dq.x = -dq.x; dq.y = -dq.y; dq.z = -dq.z; dq.w = -dq.w; }
      const angle = 2 * Math.acos(Math.min(1, dq.w));
      const s = Math.sqrt(Math.max(0, 1 - dq.w * dq.w));
      if (s < 1e-5 || angle < 1e-5) ang.set(0, 0, 0);
      else ang.set(dq.x / s, dq.y / s, dq.z / s).multiplyScalar(angle / dt);
    }

    this.lastPos.copy(pos);
    this.lastQuat.copy(quat);
    this.index = (this.index + 1) % this.size;
    this.count = Math.min(this.count + 1, this.size);
  }

  sample(age) {
    return (this.index - 1 - age + this.size * 2) % this.size;
  }

  /** Promedio suavizado de los últimos n frames. */
  getLinear(out = new THREE.Vector3(), n = this.size) {
    out.set(0, 0, 0);
    const k = Math.min(n, this.count);
    if (!k) return out;
    for (let i = 0; i < k; i++) out.add(this.linear[this.sample(i)]);
    return out.divideScalar(k);
  }

  getAngular(out = new THREE.Vector3(), n = this.size) {
    out.set(0, 0, 0);
    const k = Math.min(n, this.count);
    if (!k) return out;
    for (let i = 0; i < k; i++) out.add(this.angular[this.sample(i)]);
    return out.divideScalar(k);
  }

  /** Velocidad instantánea (último frame). */
  getSpeed() {
    return this.count ? this.linear[this.sample(0)].length() : 0;
  }

  /**
   * Velocidad de lanzamiento: la gente frena la mano justo antes de abrirla,
   * así que se toma el pico de los últimos N frames y se promedia con sus vecinos.
   */
  getThrowVelocity(outLinear, outAngular) {
    const k = Math.min(this.count, this.size);
    if (!k) {
      outLinear.set(0, 0, 0);
      outAngular.set(0, 0, 0);
      return;
    }
    let peak = 0, peakSpeed = -1;
    for (let i = 0; i < k; i++) {
      const s = this.linear[this.sample(i)].lengthSq();
      if (s > peakSpeed) { peakSpeed = s; peak = i; }
    }
    outLinear.set(0, 0, 0);
    outAngular.set(0, 0, 0);
    let used = 0;
    for (let i = Math.max(0, peak - 1); i <= Math.min(k - 1, peak + 1); i++) {
      outLinear.add(this.linear[this.sample(i)]);
      outAngular.add(this.angular[this.sample(i)]);
      used++;
    }
    outLinear.divideScalar(used);
    outAngular.divideScalar(used);

    // Si el pico es viejo y la mano está casi quieta (soltó suave), usar el promedio reciente
    const recent = this.getLinear(new THREE.Vector3(), INTERACTION.throwSamples);
    if (recent.length() < 0.6 && peak > 3) {
      outLinear.copy(recent);
      this.getAngular(outAngular, INTERACTION.throwSamples);
    }
  }
}
