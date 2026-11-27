import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PHYSICS, GROUP, interactionGroups, ALL_GROUPS } from '../config.js';

/**
 * Objeto físico: une un RigidBody de Rapier con su malla de Three.js.
 * Guarda el estado previo/actual para interpolar el render entre pasos fijos
 * y las velocidades previas al paso para medir impactos reales.
 */
export class PhysicsObject {
  constructor(world, body, colliders, mesh, userData) {
    this.world = world;
    this.body = body;
    this.colliders = colliders;
    this.mesh = mesh;
    this.userData = userData || {};
    this.isStatic = body.isFixed();
    this.prevPos = new THREE.Vector3();
    this.prevQuat = new THREE.Quaternion();
    this.currPos = new THREE.Vector3();
    this.currQuat = new THREE.Quaternion();
    this.preLin = new THREE.Vector3();
    this.preAng = new THREE.Vector3();
    this.prePos = new THREE.Vector3();
    this.alive = true;
    this.snap();
  }

  /** Copia la pose actual del cuerpo a prev/curr (tras teletransportar o crear). */
  snap() {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.currPos.set(t.x, t.y, t.z);
    this.currQuat.set(r.x, r.y, r.z, r.w);
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
    this.prePos.copy(this.currPos);
  }

  get mass() {
    return this.body.mass();
  }

  setPose(position, quaternion) {
    this.body.setTranslation(position, true);
    if (quaternion) this.body.setRotation(quaternion, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.snap();
  }

  linvel(out = new THREE.Vector3()) {
    const v = this.body.linvel();
    return out.set(v.x, v.y, v.z);
  }

  angvel(out = new THREE.Vector3()) {
    const v = this.body.angvel();
    return out.set(v.x, v.y, v.z);
  }

  /** Velocidad de un punto del cuerpo usando el estado previo al paso (v_com + ω × r). */
  preStepPointVelocity(point, out = new THREE.Vector3()) {
    if (this.isStatic) return out.set(0, 0, 0);
    const r = _tmp.copy(point).sub(this.prePos);
    return out.copy(this.preAng).cross(r).add(this.preLin);
  }
}

const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();

/**
 * Mundo de físicas: paso fijo (120 Hz) con acumulador, CCD por cuerpo,
 * cola de eventos de colisión y consultas (rayos / proyección de puntos).
 */
export class PhysicsWorld {
  static async init() {
    await RAPIER.init();
  }

  constructor() {
    this.RAPIER = RAPIER;
    this.impactListeners = new Set();
    this.preStepListeners = new Set();
    this.create();
  }

  create() {
    this.world = new RAPIER.World({ x: 0, y: PHYSICS.gravity, z: 0 });
    this.world.timestep = PHYSICS.fixedStep;
    this.world.integrationParameters.numSolverIterations = 6;
    this.eventQueue = new RAPIER.EventQueue(true);
    this.objects = new Set();
    this.dynamicObjects = new Set();
    this.colliderMap = new Map();
    this.accumulator = 0;
    this.alpha = 0;
  }

  /** Libera el mundo completo (cambio de escena) y crea uno nuevo. */
  reset() {
    this.world.free();
    this.eventQueue.free();
    this.create();
  }

  onImpact(fn) {
    this.impactListeners.add(fn);
    return () => this.impactListeners.delete(fn);
  }

  onPreStep(fn) {
    this.preStepListeners.add(fn);
    return () => this.preStepListeners.delete(fn);
  }

  // ---------------------------------------------------------------------------
  // Creación de cuerpos
  // ---------------------------------------------------------------------------

  /** Colisionador estático (paredes, piso, mesas). `shapes`: [{desc, position, quaternion}] o ColliderDesc. */
  addStatic(colliderDescs, userData = { kind: 'static' }, mesh = null) {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const colliders = colliderDescs.map((d) => {
      d.setCollisionGroups(interactionGroups(GROUP.STATIC, ALL_GROUPS));
      return this.world.createCollider(d, body);
    });
    const obj = new PhysicsObject(this, body, colliders, mesh, userData);
    this.register(obj);
    return obj;
  }

  /** Caja estática alineada (atajo para arquitectura). */
  addStaticBox(center, halfExtents, quaternion = null, userData = { kind: 'static' }) {
    const d = RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z).setTranslation(center.x, center.y, center.z);
    if (quaternion) d.setRotation(quaternion);
    return this.addStatic([d], userData);
  }

  /**
   * Cuerpo dinámico con colliders compuestos.
   * opts: { mesh, position, quaternion, colliders: ColliderDesc[], ccd, linearDamping, angularDamping,
   *         group, filter, userData, events, canSleep }
   */
  addDynamic(opts) {
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(opts.position.x, opts.position.y, opts.position.z)
      .setLinearDamping(opts.linearDamping ?? 0.05)
      .setAngularDamping(opts.angularDamping ?? 0.12)
      .setCcdEnabled(!!opts.ccd)
      .setCanSleep(opts.canSleep ?? true);
    if (opts.quaternion) desc.setRotation(opts.quaternion);
    const body = this.world.createRigidBody(desc);
    const group = interactionGroups(opts.group ?? GROUP.DEVICE, opts.filter ?? ALL_GROUPS);
    const colliders = opts.colliders.map((d) => {
      d.setCollisionGroups(group);
      if (opts.events !== false) d.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      return this.world.createCollider(d, body);
    });
    const obj = new PhysicsObject(this, body, colliders, opts.mesh || null, opts.userData);
    this.register(obj);
    return obj;
  }

  register(obj) {
    this.objects.add(obj);
    if (!obj.isStatic) this.dynamicObjects.add(obj);
    obj.colliders.forEach((c) => this.colliderMap.set(c.handle, obj));
  }

  remove(obj) {
    if (!obj || !obj.alive) return;
    obj.alive = false;
    obj.colliders.forEach((c) => this.colliderMap.delete(c.handle));
    this.objects.delete(obj);
    this.dynamicObjects.delete(obj);
    this.world.removeRigidBody(obj.body);
  }

  setGroups(obj, membership, filter = ALL_GROUPS) {
    const g = interactionGroups(membership, filter);
    obj.colliders.forEach((c) => c.setCollisionGroups(g));
  }

  // ---------------------------------------------------------------------------
  // Simulación
  // ---------------------------------------------------------------------------

  step(frameDt) {
    const h = PHYSICS.fixedStep;
    this.accumulator += Math.min(frameDt, 0.1);
    let steps = Math.floor(this.accumulator / h);
    if (steps > PHYSICS.maxSubSteps) {
      steps = PHYSICS.maxSubSteps;
      this.accumulator = steps * h;
    }

    if (steps > 0) {
      for (const obj of this.dynamicObjects) {
        obj.prevPos.copy(obj.currPos);
        obj.prevQuat.copy(obj.currQuat);
      }
    }

    for (let i = 0; i < steps; i++) {
      // Interpolación de objetivos (manos) dentro del frame: subpaso i de n
      const t = (i + 1) / steps;
      this.preStepListeners.forEach((fn) => fn(h, t));

      for (const obj of this.dynamicObjects) {
        if (obj.body.isSleeping()) {
          obj.preLin.set(0, 0, 0);
          obj.preAng.set(0, 0, 0);
          continue;
        }
        obj.linvel(obj.preLin);
        obj.angvel(obj.preAng);
        // linvel de Rapier es la velocidad del centro de masa
        const p = obj.body.worldCom();
        obj.prePos.set(p.x, p.y, p.z);
      }

      this.world.step(this.eventQueue);
      this.eventQueue.drainCollisionEvents((h1, h2, started) => {
        if (started) this.handleCollision(h1, h2);
      });
      this.accumulator -= h;
    }

    if (steps > 0) {
      for (const obj of this.dynamicObjects) {
        const tr = obj.body.translation();
        const rot = obj.body.rotation();
        obj.currPos.set(tr.x, tr.y, tr.z);
        obj.currQuat.set(rot.x, rot.y, rot.z, rot.w);
      }
    }
    this.alpha = this.accumulator / h;
  }

  handleCollision(h1, h2) {
    const o1 = this.colliderMap.get(h1);
    const o2 = this.colliderMap.get(h2);
    if (!o1 || !o2 || !this.impactListeners.size) return;
    const c1 = this.world.getCollider(h1);
    const c2 = this.world.getCollider(h2);

    let point = null;
    const normal = new THREE.Vector3();
    this.world.contactPair(c1, c2, (manifold, flipped) => {
      if (point || manifold.numSolverContacts() === 0) return;
      const p = manifold.solverContactPoint(0);
      point = new THREE.Vector3(p.x, p.y, p.z);
      const n = manifold.normal();
      normal.set(n.x, n.y, n.z);
      if (flipped) normal.negate();
    });
    if (!point) point = _tmp2.copy(o1.prePos).add(o2.prePos).multiplyScalar(0.5).clone();

    const v1 = o1.preStepPointVelocity(point, new THREE.Vector3());
    const v2 = o2.preStepPointVelocity(point, new THREE.Vector3());
    const relVel = v1.sub(v2);
    const total = relVel.length();
    const alongNormal = normal.lengthSq() > 0 ? Math.abs(relVel.dot(normal)) : total;
    // Golpe frontal pesa más que un roce tangencial
    const speed = Math.max(alongNormal, total * 0.55);

    const impact = { a: o1, b: o2, colliderA: h1, colliderB: h2, speed, point, normal, relVel };
    this.impactListeners.forEach((fn) => fn(impact));
  }

  /** Copia las poses interpoladas a las mallas de Three.js. */
  syncMeshes() {
    const a = this.alpha;
    for (const obj of this.dynamicObjects) {
      if (!obj.mesh) continue;
      obj.mesh.position.lerpVectors(obj.prevPos, obj.currPos, a);
      obj.mesh.quaternion.slerpQuaternions(obj.prevQuat, obj.currQuat, a);
    }
  }

  // ---------------------------------------------------------------------------
  // Consultas
  // ---------------------------------------------------------------------------

  castRay(origin, direction, maxDistance, predicate = null, groups = undefined) {
    const ray = new RAPIER.Ray(origin, direction);
    const hit = this.world.castRayAndGetNormal(
      ray, maxDistance, true, undefined, groups, undefined, undefined,
      predicate ? (collider) => predicate(this.colliderMap.get(collider.handle), collider) : undefined
    );
    if (!hit) return null;
    const toi = hit.timeOfImpact ?? hit.toi;
    return {
      distance: toi,
      point: new THREE.Vector3(origin.x + direction.x * toi, origin.y + direction.y * toi, origin.z + direction.z * toi),
      normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
      object: this.colliderMap.get(hit.collider.handle) || null
    };
  }

  /** Objeto más cercano a un punto (dentro de maxDistance) que cumpla el predicado. */
  nearestObject(point, maxDistance, predicate) {
    const proj = this.world.projectPoint(
      point, true, undefined, undefined, undefined, undefined,
      (collider) => {
        const obj = this.colliderMap.get(collider.handle);
        return !!obj && predicate(obj);
      }
    );
    if (!proj) return null;
    const p = proj.point;
    const dist = proj.isInside ? 0 : Math.hypot(p.x - point.x, p.y - point.y, p.z - point.z);
    if (dist > maxDistance) return null;
    return { object: this.colliderMap.get(proj.collider.handle), distance: dist };
  }
}

export { RAPIER };
