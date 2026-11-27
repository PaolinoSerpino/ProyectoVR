import * as THREE from 'three';
import { Materials } from '../../core/render/Materials.js';
import { TextPanel, fitText, roundRect } from '../../core/ui/TextPanel.js';
import { PhysicalButton } from '../../core/ui/PhysicalButton.js';
import { RAPIER } from '../../core/physics/PhysicsWorld.js';
import { PALETTE } from '../../core/config.js';

/**
 * Portal/puerta física modular del lobby.
 * - Activo: la hoja de la puerta se abre sola cuando el jugador se acerca y deja ver
 *   una membrana animada; cruzarla (caminando o teletransportándose) entra al minijuego.
 *   También hay un botón físico "ENTRAR" al costado.
 * - Próximamente: puerta cerrada con colisión, candado y cartel.
 */
export class Portal {
  constructor({ entry, record, onEnter, physics, parentScene }) {
    this.entry = entry;
    this.onEnter = onEnter;
    this.active = !entry.comingSoon;
    this.root = new THREE.Group();
    this.doorOpen = 0;
    this.time = Math.random() * 10;

    const width = 1.5, height = 2.55, depth = 0.4;
    this.width = width;
    const frameMat = Materials.paintedMetal(PALETTE.botanicalDark, [1, 2]);
    const woodMat = Materials.toolWood([1, 2]);

    // Marco arquitectónico: jambas + dintel de madera con filete verde bosque
    const jambGeo = new THREE.BoxGeometry(0.22, height + 0.2, depth);
    [-1, 1].forEach((s) => {
      const jamb = new THREE.Mesh(jambGeo, woodMat);
      jamb.position.set(s * (width / 2 + 0.11), (height + 0.2) / 2, 0);
      jamb.castShadow = jamb.receiveShadow = true;
      this.root.add(jamb);
      const trim = new THREE.Mesh(new THREE.BoxGeometry(0.05, height + 0.2, depth + 0.04), frameMat);
      trim.position.set(s * (width / 2 + 0.005), (height + 0.2) / 2, 0);
      this.root.add(trim);
    });
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(width + 0.66, 0.34, depth + 0.08), frameMat);
    lintel.position.set(0, height + 0.37, 0);
    lintel.castShadow = true;
    this.root.add(lintel);

    // Cartel del portal
    const sign = new TextPanel({
      width: 1.9, height: 0.42, pxPerMeter: 600, emissiveIntensity: this.active ? 1.1 : 0.6,
      draw: (ctx, w, h) => this.drawSign(ctx, w, h, record)
    });
    sign.mesh.position.set(0, height + 0.37, depth / 2 + 0.045);
    this.root.add(sign.mesh);
    this.sign = sign;

    // Membrana del portal (shader animado)
    this.membraneMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uActive: { value: this.active ? 1 : 0 },
        uA: { value: new THREE.Color(PALETTE.forest) },
        uB: { value: new THREE.Color(0xd8f3dc) },
        uC: { value: new THREE.Color(0xe9c46a) }
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `
        uniform float uTime; uniform float uActive; uniform vec3 uA; uniform vec3 uB; uniform vec3 uC; varying vec2 vUv;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
        void main(){
          vec2 p = vUv - 0.5; p.y *= 1.7;
          float r = length(p); float a = atan(p.y, p.x);
          float swirl = noise(vec2(a * 2.0 + uTime * 0.6 - r * 6.0, r * 5.0 - uTime * 0.8));
          float rings = sin(r * 26.0 - uTime * 3.0) * 0.5 + 0.5;
          vec3 col = mix(uA, uB, swirl * 0.8 + rings * 0.2);
          col = mix(col, uC, smoothstep(0.55, 0.95, swirl) * 0.5);
          float edge = smoothstep(0.5, 0.42, abs(vUv.x - 0.5)) * smoothstep(0.5, 0.46, abs(vUv.y - 0.5));
          gl_FragColor = vec4(col * (1.2 + 0.6 * uActive), 0.92 * edge * uActive);
        }`
    });
    const membrane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), this.membraneMat);
    membrane.position.set(0, height / 2, -0.06);
    this.root.add(membrane);

    // Hoja de la puerta (bisagra en el borde izquierdo)
    this.doorPivot = new THREE.Group();
    this.doorPivot.position.set(-width / 2, 0, 0.08);
    const door = new THREE.Group();
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(width - 0.02, height - 0.02, 0.06), woodMat);
    leaf.position.set(width / 2, height / 2, 0);
    leaf.castShadow = leaf.receiveShadow = true;
    door.add(leaf);
    // Paneles rehundidos verde bosque + manija de bronce
    [0.62, 1.72].forEach((y) => {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(width - 0.36, 0.78, 0.02), Materials.plastic(PALETTE.forest, 0.6));
      panel.position.set(width / 2, y, 0.035);
      door.add(panel);
    });
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.22, 12), Materials.aluminium(0xc9a227));
    handle.position.set(width - 0.16, 1.05, 0.08);
    door.add(handle);
    this.doorPivot.add(door);
    this.root.add(this.doorPivot);

    if (!this.active) {
      // Candado + banda "PRÓXIMAMENTE"
      const lock = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.06), Materials.aluminium(0xc9a227));
      const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.013, 8, 20, Math.PI), Materials.brushedSteel());
      shackle.position.y = 0.07;
      lock.add(body, shackle);
      lock.position.set(width / 2 + 0.55, 1.1, 0.13);
      door.add(lock);
    }

    // Botón físico ENTRAR (solo portal activo)
    if (this.active) {
      this.enterButton = new PhysicalButton({
        label: 'ENTRAR', sublabel: entry.title, color: 0x3a8f55, radius: 0.08,
        onPress: () => this.onEnter(entry.id)
      });
      const pedestal = new THREE.Mesh(new THREE.BoxGeometry(0.34, 1.0, 0.3), Materials.toolWood());
      pedestal.position.set(width / 2 + 0.75, 0.5, 0.55);
      pedestal.castShadow = pedestal.receiveShadow = true;
      this.root.add(pedestal);
      this.enterButton.root.position.set(width / 2 + 0.75, 1.0, 0.55);
      this.enterButton.root.rotation.x = -Math.PI / 2 + 0.5;
      parentScene.addButton(this.enterButton, this.root);
      this.pedestal = pedestal;

      this.glow = new THREE.PointLight(0x9ed4a8, 0, 5, 2);
      this.glow.position.set(0, 1.4, 0.6);
      this.root.add(this.glow);
    }

    this.physics = physics;
  }

  drawSign(ctx, w, h, record) {
    ctx.fillStyle = this.active ? '#1B281E' : '#2b2e2c';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = this.active ? '#9ED4A8' : '#6c706d';
    ctx.lineWidth = 6;
    roundRect(ctx, 8, 8, w - 16, h - 16, 18);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = this.active ? '#F4F0EA' : '#c9c4ba';
    fitText(ctx, this.entry.title, w / 2, h * 0.38, w * 0.9, 92, '800');
    ctx.fillStyle = this.active ? '#E9C46A' : '#8e928f';
    const sub = this.active
      ? (record ? `RÉCORD: ${record.score.toLocaleString('es-AR')} PTS` : 'SIN RÉCORD TODAVÍA')
      : this.entry.subtitle;
    fitText(ctx, sub, w / 2, h * 0.74, w * 0.85, 44, '700');
  }

  /** Colisionadores estáticos del marco (y de la puerta si está cerrada) en coordenadas mundo. */
  buildColliders() {
    this.root.updateWorldMatrix(true, true);
    const q = new THREE.Quaternion();
    this.root.getWorldQuaternion(q);
    const add = (local, half) => {
      const p = local.clone().applyMatrix4(this.root.matrixWorld);
      const d = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setTranslation(p.x, p.y, p.z).setRotation(q);
      this.physics.addStatic([d], { kind: 'static', surface: 'wood' });
    };
    const w = this.width;
    add(new THREE.Vector3(-(w / 2 + 0.11), 1.375, 0), new THREE.Vector3(0.11, 1.375, 0.2));
    add(new THREE.Vector3(w / 2 + 0.11, 1.375, 0), new THREE.Vector3(0.11, 1.375, 0.2));
    if (!this.active) add(new THREE.Vector3(0, 1.275, 0.08), new THREE.Vector3(w / 2, 1.275, 0.04));
    if (this.pedestal) add(this.pedestal.position.clone(), new THREE.Vector3(0.17, 0.5, 0.15));
  }

  /** @returns {boolean} true si la cabeza del jugador cruzó la membrana */
  update(dt, headWorld) {
    this.time += dt;
    this.membraneMat.uniforms.uTime.value = this.time;
    if (!this.active) return false;

    const local = this.root.worldToLocal(headWorld.clone());
    const near = Math.hypot(local.x, local.z) < 2.8;
    this.doorOpen += ((near ? 1 : 0) - this.doorOpen) * Math.min(1, dt * 3);
    this.doorPivot.rotation.y = -this.doorOpen * 1.75;
    this.glow.intensity = 0.4 + this.doorOpen * 2.2;

    return this.doorOpen > 0.6 && Math.abs(local.x) < this.width / 2 - 0.1 && local.z < 0.05 && local.z > -0.6;
  }
}
