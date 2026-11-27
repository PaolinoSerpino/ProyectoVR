import * as THREE from 'three';
import { TextPanel, fitText } from './TextPanel.js';
import { Materials } from '../render/Materials.js';

/**
 * Botón físico 3D (pared/pedestal). Se presiona:
 *  - en VR, metiendo la mano (punto de agarre) o la cabeza del martillo dentro del botón;
 *  - en PC, con clic izquierdo apuntando con la mira (registro en `interactables`).
 * El capuchón se hunde de forma proporcional y dispara `onPress` al pasar el 70% del recorrido.
 */
export class PhysicalButton {
  constructor({ label, color = 0xc0392b, radius = 0.09, onPress, sublabel = '' }) {
    this.onPress = onPress;
    this.radius = radius;
    this.travel = 0.03;
    this.depth = 0;
    this.cooldown = 0;
    this.enabled = true;

    this.root = new THREE.Group();
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.35, radius * 1.45, 0.05, 40), Materials.paintedMetal(0x2a2d2f));
    housing.rotation.x = Math.PI / 2;
    housing.position.z = 0.025;
    housing.castShadow = housing.receiveShadow = true;

    this.cap = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, 0.045, 40),
      new THREE.MeshPhysicalMaterial({ color, roughness: 0.25, clearcoat: 0.8, emissive: color, emissiveIntensity: 0.25 })
    );
    this.cap.rotation.x = Math.PI / 2;
    this.cap.position.z = 0.06;
    this.cap.castShadow = true;
    this.capRestZ = 0.06;

    const plate = new TextPanel({
      width: 0.42, height: 0.12, pxPerMeter: 1024,
      draw: (ctx, w, h) => {
        ctx.fillStyle = '#16191b';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#F4F0EA';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        fitText(ctx, label, w / 2, sublabel ? h * 0.38 : h / 2, w * 0.92, 54, '800');
        if (sublabel) {
          ctx.fillStyle = '#b9c0c4';
          fitText(ctx, sublabel, w / 2, h * 0.76, w * 0.92, 30, '600');
        }
      }
    });
    plate.mesh.position.set(0, -radius * 1.35 - 0.1, 0.005);
    this.root.add(housing, this.cap, plate.mesh);
    this.cap.userData.interactable = this;
  }

  /** @param {THREE.Vector3[]} probes puntos de contacto (manos VR, cabeza del martillo) */
  update(dt, probes) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    let target = 0;
    if (this.enabled) {
      this.root.updateWorldMatrix(true, false);
      for (const p of probes) {
        const local = _local.copy(p);
        this.root.worldToLocal(local);
        const radial = Math.hypot(local.x, local.y);
        if (radial < this.radius * 1.5 && local.z < 0.12 && local.z > -0.03) {
          target = Math.max(target, THREE.MathUtils.clamp((0.1 - local.z) / this.travel, 0, 1));
        }
      }
    }
    if (this.forcedPress > 0) {
      this.forcedPress -= dt;
      target = 1;
    }
    this.depth += (target - this.depth) * Math.min(1, dt * 25);
    this.cap.position.z = this.capRestZ - this.depth * this.travel;

    if (this.depth > 0.7 && !this.latched && this.cooldown === 0) {
      this.latched = true;
      this.cooldown = 0.8;
      this.onPress?.(this);
    } else if (this.depth < 0.3) {
      this.latched = false;
    }
  }

  /** Clic del modo PC: animación de presión completa. */
  pressFromDesktop() {
    if (!this.enabled) return;
    this.forcedPress = 0.15;
  }
}

const _local = new THREE.Vector3();
