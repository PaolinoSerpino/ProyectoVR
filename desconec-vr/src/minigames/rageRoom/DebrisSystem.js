import * as THREE from 'three';
import { RAPIER } from '../../core/physics/PhysicsWorld.js';
import { GROUP, ALL_GROUPS } from '../../core/config.js';

/**
 * Escombros físicos reales (carcasas, astillas de vidrio, teclas, placas).
 * - Cada fragmento es un cuerpo dinámico con collider cuboide o convex hull.
 * - Límite duro de fragmentos activos (pooling por antigüedad) para sostener 72–90 FPS en VR:
 *   al superar el cupo se recicla el fragmento más viejo (se encoge y desaparece).
 */
export class DebrisSystem {
  constructor({ physics, root, maxFragments = 110 }) {
    this.physics = physics;
    this.root = root;
    this.max = maxFragments;
    this.fragments = [];
    this.dying = [];
  }

  /**
   * @param {object} desc receta de DeviceFactory (geometry, material, position/quaternion locales, collider, mass, kind)
   * @param {THREE.Matrix4} deviceMatrix pose mundo del equipo al romperse
   * @param {(worldPos: THREE.Vector3) => {linear: THREE.Vector3, angular: THREE.Vector3}} velocityFn
   */
  spawn(desc, deviceMatrix, velocityFn) {
    const worldPos = desc.position.clone().applyMatrix4(deviceMatrix);
    const deviceQuat = new THREE.Quaternion().setFromRotationMatrix(deviceMatrix);
    const worldQuat = deviceQuat.multiply(desc.quaternion);

    const mesh = new THREE.Mesh(desc.geometry, desc.material);
    mesh.castShadow = desc.kind !== 'glass';
    mesh.receiveShadow = true;
    mesh.position.copy(worldPos);
    mesh.quaternion.copy(worldQuat);
    desc.decorate?.(mesh);
    this.root.add(mesh);

    let colDesc = null;
    if (desc.collider.type === 'hull') colDesc = RAPIER.ColliderDesc.convexHull(desc.collider.points);
    if (!colDesc) {
      const h = desc.collider.type === 'hull' ? desc.collider.fallbackHalf : desc.collider.half;
      colDesc = RAPIER.ColliderDesc.cuboid(Math.max(0.002, h[0]), Math.max(0.002, h[1]), Math.max(0.002, h[2]));
    }
    colDesc.setMass(desc.mass).setFriction(desc.kind === 'glass' ? 0.45 : 0.7).setRestitution(desc.kind === 'key' ? 0.35 : 0.18);

    const obj = this.physics.addDynamic({
      mesh,
      position: worldPos,
      quaternion: worldQuat,
      colliders: [colDesc],
      ccd: desc.mass < 0.05,
      linearDamping: 0.08,
      angularDamping: 0.25,
      group: GROUP.FRAGMENT,
      filter: ALL_GROUPS,
      userData: { fragment: true, kind: desc.kind, grabbable: true, group: GROUP.FRAGMENT, born: performance.now() }
    });
    const v = velocityFn(worldPos);
    obj.body.setLinvel(v.linear, true);
    obj.body.setAngvel(v.angular, true);

    this.fragments.push(obj);
    while (this.fragments.length > this.max) this.retire(this.fragments.shift());
    return obj;
  }

  retire(obj) {
    if (!obj.alive) return;
    this.physics.remove(obj);
    this.dying.push({ mesh: obj.mesh, t: 0 });
  }

  update(dt) {
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const d = this.dying[i];
      d.t += dt;
      const s = Math.max(0.001, 1 - d.t / 0.35);
      d.mesh.scale.setScalar(s);
      if (d.t >= 0.35) {
        this.root.remove(d.mesh);
        d.mesh.geometry.dispose();
        this.dying.splice(i, 1);
      }
    }
    // Seguridad: escombros que escaparon del recinto
    this.fragments = this.fragments.filter((f) => {
      if (!f.alive) return false;
      if (f.currPos.y < -2) {
        this.retire(f);
        return false;
      }
      return true;
    });
  }

  clear() {
    this.fragments.forEach((f) => {
      if (f.alive) this.physics.remove(f);
      this.root.remove(f.mesh);
      f.mesh.geometry.dispose();
    });
    this.dying.forEach((d) => {
      this.root.remove(d.mesh);
      d.mesh.geometry.dispose();
    });
    this.fragments = [];
    this.dying = [];
  }
}
