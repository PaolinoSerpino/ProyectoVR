import * as THREE from 'three';
import { RAPIER } from '../../core/physics/PhysicsWorld.js';
import { Materials } from '../../core/render/Materials.js';
import { GROUP } from '../../core/config.js';

/**
 * Maza/martillo de demolición.
 * - Origen en la base del mango; el mango crece en +Y y la cabeza de acero (eje Z) está arriba.
 * - Colliders: mango (cápsula liviana) + cabeza (caja densa ≈1.5 kg) → centro de masa realista en la punta.
 * - CCD siempre activo: un martillazo rápido nunca atraviesa un monitor entre subpasos.
 * - Agarre ergonómico (snap): el mango queda alineado con el puño y la cabeza hacia adelante/arriba.
 */
export class Hammer {
  constructor({ physics, root, position, quaternion }) {
    this.physics = physics;
    this.homePos = position.clone();
    this.homeQuat = quaternion.clone();

    const mesh = new THREE.Group();
    const handleLen = 0.46;
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.019, handleLen, 18), Materials.toolWood([1, 3]));
    handle.position.y = handleLen / 2;
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.15, 18), Materials.rubber(0x1b1d1f));
    grip.position.y = 0.085;
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.021, 0.02, 18), Materials.rubber(0x1b1d1f));
    knob.position.y = 0.006;

    const steel = Materials.brushedSteel([1, 1]);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.17), steel);
    head.position.y = handleLen + 0.02;
    const faceGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.03, 24);
    const faceA = new THREE.Mesh(faceGeo, steel);
    faceA.rotation.x = Math.PI / 2;
    faceA.position.set(0, handleLen + 0.02, 0.095);
    const faceB = faceA.clone();
    faceB.position.z = -0.095;
    const wedge = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.02, 0.04), Materials.paintedMetal(0xb23a2b));
    wedge.position.y = handleLen - 0.02;
    [handle, grip, knob, head, faceA, faceB, wedge].forEach((m) => {
      m.castShadow = true;
      m.receiveShadow = true;
      mesh.add(m);
    });
    root.add(mesh);
    this.mesh = mesh;
    this.headLocal = new THREE.Vector3(0, handleLen + 0.02, 0);

    const handleCol = RAPIER.ColliderDesc.capsule(handleLen / 2 - 0.02, 0.02).setTranslation(0, handleLen / 2, 0).setMass(0.35).setFriction(0.9);
    const headCol = RAPIER.ColliderDesc.cuboid(0.037, 0.037, 0.11).setTranslation(0, handleLen + 0.02, 0).setMass(1.5).setFriction(0.5).setRestitution(0.1);

    // Pose en la mano: mango a lo largo del -Z del grip, inclinado 15° hacia arriba;
    // el punto de agarre (0, 0.08, 0) del mango coincide con el origen del grip.
    const snapQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(-75), 0, 0));
    const snapPos = new THREE.Vector3(0, -0.08, 0).applyQuaternion(snapQuat);

    this.obj = physics.addDynamic({
      mesh,
      position,
      quaternion,
      colliders: [handleCol, headCol],
      ccd: true,
      linearDamping: 0.02,
      angularDamping: 0.08,
      group: GROUP.PROP,
      userData: {
        isHammer: true,
        hammer: this,
        grabbable: true,
        alwaysCcd: true,
        group: GROUP.PROP,
        grabProfile: { snap: { position: snapPos, quaternion: snapQuat } }
      }
    });
    this.headHandle = this.obj.colliders[1].handle;
  }

  isHead(colliderHandle) {
    return colliderHandle === this.headHandle;
  }

  getHeadWorld(out = new THREE.Vector3()) {
    return out.copy(this.headLocal).applyMatrix4(this.mesh.matrixWorld);
  }

  get heldBy() {
    return this.obj.userData.heldBy || null;
  }

  resetHome() {
    this.obj.setPose(this.homePos, this.homeQuat);
    this.mesh.position.copy(this.homePos);
    this.mesh.quaternion.copy(this.homeQuat);
  }

  /** Si salió del recinto o quedó inalcanzable, vuelve al banco de trabajo. */
  update(bounds) {
    if (this.heldBy) return;
    const p = this.obj.currPos;
    if (p.y < -1 || Math.abs(p.x) > bounds.x || Math.abs(p.z) > bounds.z) this.resetHome();
  }
}
