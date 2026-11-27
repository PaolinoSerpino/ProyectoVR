import * as THREE from 'three';

/**
 * Fundido a negro pegado a la cámara (funciona igual en VR y en PC).
 * Se usa en transiciones entre lobby y minijuegos para evitar mareos.
 */
export class Fader {
  constructor(camera) {
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x0c120e, transparent: true, opacity: 1, side: THREE.BackSide, depthTest: false, depthWrite: false })
    );
    this.mesh.renderOrder = 10000;
    this.mesh.frustumCulled = false;
    camera.add(this.mesh);
    this.target = 1;
    this.speed = 3;
    this.resolve = null;
  }

  fadeTo(opacity, duration = 0.35) {
    this.target = opacity;
    this.speed = 1 / Math.max(0.01, duration);
    return new Promise((resolve) => { this.resolve = resolve; });
  }

  update(dt) {
    const m = this.mesh.material;
    const diff = this.target - m.opacity;
    const step = this.speed * dt;
    if (Math.abs(diff) <= step) {
      m.opacity = this.target;
      if (this.resolve) {
        const r = this.resolve;
        this.resolve = null;
        r();
      }
    } else {
      m.opacity += Math.sign(diff) * step;
    }
    this.mesh.visible = m.opacity > 0.001;
  }
}
