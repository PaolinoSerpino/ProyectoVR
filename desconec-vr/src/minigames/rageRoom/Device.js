import * as THREE from 'three';
import { RAPIER } from '../../core/physics/PhysicsWorld.js';
import { GROUP } from '../../core/config.js';
import { createDeviceModel } from './DeviceFactory.js';

/**
 * Equipo destructible con integridad física:
 *  - Por debajo de `minSpeed` (velocidad relativa del impacto) solo se empuja/cae con física real.
 *  - Por encima, recibe daño ∝ (velocidad − umbral) × dureza del otro cuerpo; la pantalla se agrieta
 *    en el punto exacto del golpe y parpadea.
 *  - Con integridad ≤ 0 se rompe en fragmentos físicos que heredan la velocidad del equipo más un
 *    impulso en la dirección del golpe y una expansión radial desde el punto de impacto.
 */
export class Device {
  constructor(type, seed) {
    this.type = type;
    this.seed = seed;
    this.model = createDeviceModel(type, seed);
    this.spec = this.model.spec;
    this.mesh = this.model.mesh;
    this.hp = this.spec.hp;
    this.broken = false;
    this.obj = null;

    // Estado para bonos por estilo
    this.thrown = null; // { time, position, speed }
    this.airborne = false;
    this.chainId = null;
    this.lastHitTime = 0;
  }

  spawn(physics, root, position, yaw) {
    this.physics = physics;
    this.root = root;
    const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.mesh.position.copy(position);
    this.mesh.quaternion.copy(quat);
    root.add(this.mesh);

    const colliders = this.model.colliders.map((c) => {
      const d = RAPIER.ColliderDesc.cuboid(c.half[0], c.half[1], c.half[2])
        .setTranslation(c.pos[0], c.pos[1], c.pos[2])
        .setMass(c.mass)
        .setFriction(0.75)
        .setRestitution(0.12);
      if (c.quat) d.setRotation(c.quat);
      return d;
    });
    this.obj = physics.addDynamic({
      mesh: this.mesh,
      position,
      quaternion: quat,
      colliders,
      ccd: true,
      linearDamping: 0.04,
      angularDamping: 0.1,
      group: GROUP.DEVICE,
      userData: { device: this, grabbable: true, group: GROUP.DEVICE }
    });
  }

  get name() {
    return this.spec.name;
  }

  markThrown(position, speed) {
    this.thrown = { time: performance.now(), position: position.clone(), speed };
    this.airborne = speed > 1.5;
  }

  /** Registra contacto con algo sólido que no sea el martillo: deja de estar "en el aire". */
  landed() {
    this.airborne = false;
  }

  /**
   * Aplica daño por impacto. Devuelve la cantidad de daño (0 si no superó el umbral).
   * @param {number} speed velocidad relativa en el punto de contacto (m/s)
   * @param {number} hardness multiplicador según el otro cuerpo (martillo, pared, otro equipo...)
   */
  applyImpact(speed, hardness, worldPoint) {
    if (this.broken) return 0;
    const over = speed - this.spec.minSpeed;
    if (over <= 0) return 0;
    const damage = over * hardness * 4;
    this.hp -= damage;
    this.lastHitTime = performance.now();

    // Grieta en pantalla proporcional al golpe
    if (this.model.screens.length && this.hp > 0) {
      const local = this.mesh.worldToLocal(worldPoint.clone());
      const uv = this.model.screenUV(local);
      if (uv) this.model.screens[0].crack(THREE.MathUtils.clamp(uv.u, 0, 1), THREE.MathUtils.clamp(uv.v, 0, 1), Math.min(1, damage / this.spec.hp));
    }
    return damage;
  }

  get shouldBreak() {
    return !this.broken && this.hp <= 0;
  }

  /**
   * Rompe el equipo: elimina su cuerpo y genera fragmentos.
   * @param {DebrisSystem} debris
   * @param {{point: THREE.Vector3, direction: THREE.Vector3, speed: number}} impact
   */
  shatter(debris, impact) {
    if (this.broken) return;
    this.broken = true;
    this.mesh.updateMatrixWorld(true);
    const matrix = this.mesh.matrixWorld.clone();
    const localImpact = this.mesh.worldToLocal(impact.point.clone());

    const baseLin = this.obj.linvel(new THREE.Vector3());
    const baseAng = this.obj.angvel(new THREE.Vector3());
    const com = this.obj.body.worldCom();
    const comV = new THREE.Vector3(com.x, com.y, com.z);
    const dir = impact.direction.clone();
    if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
    dir.normalize();
    const power = Math.min(impact.speed, 16);

    this.physics.remove(this.obj);
    this.root.remove(this.mesh);
    this.mesh.traverse((o) => o.geometry?.dispose());
    this.model.screens.forEach((s) => s.material.dispose());

    const frags = this.model.makeFragments(localImpact);
    frags.forEach((desc) => {
      debris.spawn(desc, matrix, (worldPos) => {
        // v = v_equipo + ω × r + empuje del golpe + expansión radial desde el impacto
        const r = worldPos.clone().sub(comV);
        const linear = baseLin.clone().add(baseAng.clone().cross(r));
        const radial = worldPos.clone().sub(impact.point);
        const dist = Math.max(0.05, radial.length());
        radial.normalize();
        const kick = power * (desc.kind === 'glass' || desc.kind === 'key' ? 0.55 : 0.32);
        linear.addScaledVector(dir, kick * (0.6 + Math.random() * 0.6));
        linear.addScaledVector(radial, (power * 0.18) / Math.min(1, dist * 4) * (0.5 + Math.random()));
        linear.y += Math.random() * 1.2;
        const angular = new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).multiplyScalar(8 + power * 1.5);
        return { linear, angular };
      });
    });
  }

  update(dt) {
    if (this.broken) return;
    this.model.screens.forEach((s) => s.update(dt));
  }

  /** Centro aproximado (para efectos). */
  getCenter(out = new THREE.Vector3()) {
    const c = this.obj.body.worldCom();
    return out.set(c.x, c.y, c.z);
  }

  dispose() {
    if (!this.broken && this.obj?.alive) this.physics.remove(this.obj);
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.mesh.traverse((o) => o.geometry?.dispose());
    this.model.screens.forEach((s) => s.material.dispose());
  }
}
