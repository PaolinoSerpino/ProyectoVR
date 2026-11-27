import * as THREE from 'three';

/**
 * Efectos de destrucción optimizados para VR:
 * - Chispas eléctricas: un único THREE.Points con buffers fijos (blending aditivo, gravedad, rebote en el piso).
 * - Destellos: pool fijo de 2 PointLights (siempre en escena → sin recompilar shaders), decaen en ~0.2 s.
 * - Humo/polvo: pool de sprites con textura radial suave que crecen, suben y se desvanecen.
 */
export class Effects {
  constructor(root) {
    this.root = root;

    // --- Chispas ---
    this.maxSparks = 700;
    const geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(this.maxSparks * 3);
    this.colors = new Float32Array(this.maxSparks * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.sparkGeo = geo;
    this.sparkMat = new THREE.PointsMaterial({
      size: 0.022, vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, map: radialTexture(), sizeAttenuation: true
    });
    this.sparks = new THREE.Points(geo, this.sparkMat);
    this.sparks.frustumCulled = false;
    root.add(this.sparks);
    this.vel = new Float32Array(this.maxSparks * 3);
    this.life = new Float32Array(this.maxSparks);
    this.maxLife = new Float32Array(this.maxSparks);
    this.base = new Float32Array(this.maxSparks * 3);
    this.cursor = 0;

    // --- Destellos (2 luces fijas: presupuesto de luces para VR) ---
    this.flashes = [0, 1].map(() => {
      const l = new THREE.PointLight(0x9fd8ff, 0, 3.5, 2);
      root.add(l);
      return { light: l, t: 1, peak: 0 };
    });
    this.flashCursor = 0;

    // --- Humo / polvo ---
    const smokeTex = radialTexture(true);
    this.puffs = Array.from({ length: 26 }, () => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, color: 0x8a8a8a, opacity: 0 }));
      s.visible = false;
      root.add(s);
      return { sprite: s, t: 0, life: 1, vel: new THREE.Vector3(), grow: 1, alpha: 0.4 };
    });
    this.puffCursor = 0;
  }

  /** Lluvia de chispas eléctricas; `dir` sesga la dirección (vector del golpe). */
  sparkBurst(point, count, dir = null, intensity = 1) {
    for (let i = 0; i < count; i++) {
      const k = this.cursor;
      this.cursor = (this.cursor + 1) % this.maxSparks;
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5).normalize();
      if (dir) v.addScaledVector(dir, 0.8).normalize();
      v.multiplyScalar((1.5 + Math.random() * 3.5) * (0.6 + intensity * 0.6));
      this.positions[k * 3] = point.x;
      this.positions[k * 3 + 1] = point.y;
      this.positions[k * 3 + 2] = point.z;
      this.vel[k * 3] = v.x;
      this.vel[k * 3 + 1] = v.y;
      this.vel[k * 3 + 2] = v.z;
      const hot = Math.random();
      this.base[k * 3] = 1;
      this.base[k * 3 + 1] = 0.75 + hot * 0.25;
      this.base[k * 3 + 2] = 0.35 + hot * 0.6;
      this.maxLife[k] = this.life[k] = 0.35 + Math.random() * 0.55;
    }
    this.flash(point, 0x9fd8ff, 3.5 * intensity);
  }

  /** Confeti dorado (récord). */
  goldBurst(point, count) {
    for (let i = 0; i < count; i++) {
      const k = this.cursor;
      this.cursor = (this.cursor + 1) % this.maxSparks;
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.4 + 0.2, Math.random() * 0.6).normalize().multiplyScalar(2 + Math.random() * 2.5);
      this.positions.set([point.x, point.y, point.z], k * 3);
      this.vel.set([v.x, v.y, v.z], k * 3);
      this.base.set([1, 0.82, 0.35], k * 3);
      this.maxLife[k] = this.life[k] = 1.2 + Math.random() * 0.8;
    }
    this.flash(point, 0xffd166, 4);
  }

  flash(point, color, intensity) {
    const f = this.flashes[this.flashCursor];
    this.flashCursor = (this.flashCursor + 1) % this.flashes.length;
    f.light.position.copy(point);
    f.light.color.set(color);
    f.peak = intensity;
    f.t = 0;
  }

  /** Humo oscuro (cortocircuito) o polvo claro (plástico/hormigón). */
  puff(point, { smoke = false, count = 3, size = 0.25 } = {}) {
    for (let i = 0; i < count; i++) {
      const p = this.puffs[this.puffCursor];
      this.puffCursor = (this.puffCursor + 1) % this.puffs.length;
      p.sprite.position.copy(point).add(new THREE.Vector3((Math.random() - 0.5) * 0.1, Math.random() * 0.05, (Math.random() - 0.5) * 0.1));
      p.sprite.material.color.set(smoke ? 0x2f3133 : 0xa59f96);
      p.vel.set((Math.random() - 0.5) * 0.25, smoke ? 0.35 + Math.random() * 0.2 : 0.12, (Math.random() - 0.5) * 0.25);
      p.t = 0;
      p.life = smoke ? 2.2 : 1.3;
      p.grow = size * (0.8 + Math.random() * 0.5);
      p.alpha = smoke ? 0.45 : 0.32;
      p.sprite.visible = true;
    }
  }

  update(dt) {
    let any = false;
    for (let k = 0; k < this.maxSparks; k++) {
      if (this.life[k] <= 0) {
        this.colors[k * 3] = this.colors[k * 3 + 1] = this.colors[k * 3 + 2] = 0;
        continue;
      }
      any = true;
      this.life[k] -= dt;
      const i = k * 3;
      this.vel[i + 1] -= 9.8 * dt;
      this.vel[i] *= 0.985;
      this.vel[i + 2] *= 0.985;
      this.positions[i] += this.vel[i] * dt;
      this.positions[i + 1] += this.vel[i + 1] * dt;
      this.positions[i + 2] += this.vel[i + 2] * dt;
      if (this.positions[i + 1] < 0.005) {
        this.positions[i + 1] = 0.005;
        this.vel[i + 1] *= -0.35;
        this.vel[i] *= 0.6;
        this.vel[i + 2] *= 0.6;
      }
      const fade = Math.max(0, this.life[k] / this.maxLife[k]);
      this.colors[i] = this.base[i] * fade;
      this.colors[i + 1] = this.base[i + 1] * fade * fade;
      this.colors[i + 2] = this.base[i + 2] * fade * fade * fade;
    }
    if (any || this.wasActive) {
      this.sparkGeo.attributes.position.needsUpdate = true;
      this.sparkGeo.attributes.color.needsUpdate = true;
    }
    this.wasActive = any;

    for (const f of this.flashes) {
      if (f.t >= 1) {
        f.light.intensity = 0;
        continue;
      }
      f.t = Math.min(1, f.t + dt / 0.22);
      f.light.intensity = f.peak * Math.pow(1 - f.t, 2);
    }

    for (const p of this.puffs) {
      if (!p.sprite.visible) continue;
      p.t += dt;
      const k = p.t / p.life;
      if (k >= 1) {
        p.sprite.visible = false;
        continue;
      }
      p.sprite.position.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(0.985);
      const s = p.grow * (0.4 + k * 1.6);
      p.sprite.scale.set(s, s, s);
      p.sprite.material.opacity = p.alpha * Math.sin(Math.PI * Math.min(1, k * 1.2));
    }
  }

  clear() {
    this.life.fill(0);
    this.puffs.forEach((p) => { p.sprite.visible = false; });
    this.flashes.forEach((f) => { f.t = 1; f.light.intensity = 0; });
  }
}

function radialTexture(soft = false) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  if (soft) {
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
  } else {
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.8)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
