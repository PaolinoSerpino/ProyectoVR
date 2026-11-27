import * as THREE from 'three';

/**
 * Escena base (lobby o minijuego). Contrato del ciclo de vida:
 *   mount(ctx)      → construye geometría, luces y cuerpos físicos dentro de `this.root`.
 *   update(dt, t)   → lógica por frame (después del paso de física).
 *   unmount()       → limpia todo; App resetea el mundo físico y suelta los objetos en mano.
 */
export class BaseScene {
  constructor(id) {
    this.id = id;
    this.root = new THREE.Group();
    this.root.name = `scene:${id}`;
    this.spawn = { position: new THREE.Vector3(0, 0, 0), yaw: 0 };
    this.environment = 'studio';
    this.exposure = 1;
    this.background = new THREE.Color(0x111111);
    this.fog = null;
    this.buttons = [];
    this.ctx = null;
  }

  async mount(ctx) {
    this.ctx = ctx;
    ctx.scene.add(this.root);
  }

  update(_dt, _time) {}

  unmount() {
    if (!this.ctx) return;
    this.ctx.scene.remove(this.root);
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material?.userData?.disposable) o.material.dispose();
    });
    this.buttons = [];
    this.ctx = null;
  }

  /** Filtro de teletransporte: por defecto cualquier piso estático. */
  isTeleportable(_point) {
    return true;
  }

  /** Puntos extra que pueden presionar botones 3D (ej. cabeza del martillo). */
  getButtonProbes() {
    return [];
  }

  addButton(button, parent = this.root) {
    this.buttons.push(button);
    parent.add(button.root);
    return button;
  }
}
