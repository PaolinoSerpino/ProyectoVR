import * as THREE from 'three';
import { BaseScene } from '../../core/BaseScene.js';
import { Materials } from '../../core/render/Materials.js';
import { TextPanel, fitText, roundRect } from '../../core/ui/TextPanel.js';
import { RAPIER } from '../../core/physics/PhysicsWorld.js';
import { PALETTE } from '../../core/config.js';
import { MINIGAMES } from '../../minigames/registry.js';
import { Portal } from './Portal.js';

/**
 * Lobby "Desconec-VR": galería botánica circular, minimalista y orgánica.
 * Sin computadoras, escritorios ni sillas: tragaluz cenital, plantas, agua quieta,
 * tótem con el logo, tablero de Récord Histórico y portales modulares a los minijuegos.
 */
const RADIUS = 9;
const WALL_HEIGHT = 5;

export class LobbyScene extends BaseScene {
  constructor() {
    super('lobby');
    this.environment = 'botanical';
    this.exposure = 1.0;
    this.background = new THREE.Color(0xdfe6d6);
    this.spawn = { position: new THREE.Vector3(0, 0, 4.6), yaw: 0 };
    this.portals = [];
  }

  async mount(ctx) {
    await super.mount(ctx);
    this.buildArchitecture();
    this.buildLighting();
    this.buildTotem();
    this.buildPlants();
    this.buildRecordBoard();
    this.buildPortals();
  }

  // ---------------------------------------------------------------------------
  // Arquitectura: piso de madera, muro curvo de estuco, cubierta con tragaluz
  // ---------------------------------------------------------------------------
  buildArchitecture() {
    const { physics } = this.ctx;

    const floor = new THREE.Mesh(new THREE.CircleGeometry(RADIUS, 72), Materials.woodFloor([7, 7]));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.root.add(floor);
    physics.addStatic([RAPIER.ColliderDesc.cuboid(RADIUS + 1, 0.1, RADIUS + 1).setTranslation(0, -0.1, 0)], { kind: 'static', surface: 'wood' });

    // Zócalo verde bosque + muro curvo de estuco arena
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(RADIUS, RADIUS, WALL_HEIGHT, 72, 1, true), Materials.plaster([10, 2]));
    wall.material.side = THREE.BackSide;
    wall.position.y = WALL_HEIGHT / 2;
    wall.receiveShadow = true;
    this.root.add(wall);
    const skirting = new THREE.Mesh(
      new THREE.CylinderGeometry(RADIUS - 0.02, RADIUS - 0.02, 0.18, 72, 1, true),
      new THREE.MeshStandardMaterial({ color: PALETTE.forest, roughness: 0.6, side: THREE.BackSide })
    );
    skirting.material.userData.disposable = true;
    skirting.position.y = 0.09;
    this.root.add(skirting);

    const segs = 28;
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
      const d = RAPIER.ColliderDesc.cuboid(0.25, WALL_HEIGHT / 2, (Math.PI * 2 * RADIUS) / segs / 2 + 0.05)
        .setTranslation(Math.cos(a) * (RADIUS + 0.25), WALL_HEIGHT / 2, Math.sin(a) * (RADIUS + 0.25))
        .setRotation(q);
      physics.addStatic([d], { kind: 'static', surface: 'plaster' });
    }

    // Cubierta anular con vigas radiales de madera y tragaluz central
    const ceiling = new THREE.Mesh(new THREE.RingGeometry(3.4, RADIUS + 0.1, 72, 1), Materials.plaster([6, 6]));
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = WALL_HEIGHT;
    ceiling.castShadow = true;
    this.root.add(ceiling);
    const beamMat = Materials.toolWood([1, 4]);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.24, RADIUS - 3.3), beamMat);
      beam.position.set(Math.cos(a) * (3.3 + (RADIUS - 3.3) / 2), WALL_HEIGHT - 0.12, Math.sin(a) * (3.3 + (RADIUS - 3.3) / 2));
      beam.rotation.y = -a + Math.PI / 2;
      beam.castShadow = true;
      this.root.add(beam);
    }
    const skylightRing = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.09, 12, 72), Materials.paintedMetal(PALETTE.botanicalDark));
    skylightRing.rotation.x = Math.PI / 2;
    skylightRing.position.y = WALL_HEIGHT;
    this.root.add(skylightRing);
    const skyGlass = new THREE.Mesh(
      new THREE.CircleGeometry(3.4, 64),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff8ea).multiplyScalar(1.6) })
    );
    skyGlass.material.userData.disposable = true;
    skyGlass.rotation.x = Math.PI / 2;
    skyGlass.position.y = WALL_HEIGHT + 0.6;
    this.root.add(skyGlass);
    // Faldón del tragaluz (pozo de luz)
    const well = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 0.6, 64, 1, true), Materials.plaster([6, 1]));
    well.material = well.material.clone();
    well.material.side = THREE.DoubleSide;
    well.material.userData.disposable = true;
    well.position.y = WALL_HEIGHT + 0.3;
    this.root.add(well);
  }

  buildLighting() {
    const hemi = new THREE.HemisphereLight(0xfff4e0, 0x3a5a40, 1.1);
    this.root.add(hemi);

    // Sol cenital entrando por el tragaluz: pozo de luz con sombras suaves
    const sun = new THREE.DirectionalLight(0xfff1d6, 3.4);
    sun.position.set(2.2, 14, 1.2);
    sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -RADIUS;
    sun.shadow.camera.right = RADIUS;
    sun.shadow.camera.top = RADIUS;
    sun.shadow.camera.bottom = -RADIUS;
    sun.shadow.camera.near = 4;
    sun.shadow.camera.far = 24;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 4;
    this.root.add(sun, sun.target);

    // Bañador cálido rasante sobre el muro (luz indirecta del estuco)
    const fill = new THREE.PointLight(0xffe2b8, 6, 14, 2);
    fill.position.set(0, 3.6, 0);
    this.root.add(fill);
  }

  // ---------------------------------------------------------------------------
  // Tótem central DESCONEC-VR sobre espejo de agua
  // ---------------------------------------------------------------------------
  buildTotem() {
    const { physics } = this.ctx;
    const group = new THREE.Group();
    this.root.add(group);

    const basin = new THREE.Mesh(new THREE.CylinderGeometry(1.65, 1.75, 0.32, 64), Materials.concrete([2, 1]));
    basin.position.y = 0.16;
    basin.castShadow = basin.receiveShadow = true;
    group.add(basin);
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(1.5, 64),
      new THREE.MeshPhysicalMaterial({ color: 0x1d3b2f, roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, reflectivity: 0.9 })
    );
    water.material.userData.disposable = true;
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.322;
    group.add(water);
    physics.addStatic([RAPIER.ColliderDesc.cylinder(0.16, 1.75).setTranslation(0, 0.16, 0)], { kind: 'static', surface: 'concrete' });

    // Pilar hexagonal oscuro con filetes verdes
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 2.3, 6), Materials.paintedMetal(PALETTE.botanicalDark, [1, 3]));
    pillar.position.y = 0.3 + 1.15;
    pillar.castShadow = pillar.receiveShadow = true;
    group.add(pillar);
    for (let i = 0; i < 3; i++) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.47 - i * 0.02, 0.47 - i * 0.02, 0.05, 6), Materials.plastic(PALETTE.forest, 0.45));
      band.position.y = 0.7 + i * 0.65;
      group.add(band);
    }
    physics.addStatic([RAPIER.ColliderDesc.cylinder(1.3, 0.5).setTranslation(0, 1.6, 0)], { kind: 'static' });

    // Placa con logo + letrero en las caras frontales
    const logoTex = new THREE.TextureLoader().load('/logo.png');
    logoTex.colorSpace = THREE.SRGBColorSpace;
    const plaqueMat = new THREE.MeshStandardMaterial({ map: logoTex, transparent: true, roughness: 0.5, emissive: 0xffffff, emissiveMap: logoTex, emissiveIntensity: 0.35 });
    plaqueMat.userData.disposable = true;
    const titlePanel = new TextPanel({
      width: 1.6, height: 0.36, pxPerMeter: 640, emissiveIntensity: 1.2,
      draw: (ctx, w, h) => {
        ctx.fillStyle = '#1B281E';
        ctx.fillRect(0, 0, w, h);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#F4F0EA';
        fitText(ctx, 'DESCONEC-VR', w / 2, h * 0.45, w * 0.92, 150, '900');
        ctx.fillStyle = '#9ED4A8';
        fitText(ctx, 'GALERÍA DE DESCONEXIÓN', w / 2, h * 0.84, w * 0.8, 40, '600');
      }
    });
    titlePanel.mesh.position.set(0, 2.85, 0.75);
    group.add(titlePanel.mesh);
    const titleBack = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.44, 0.08), Materials.paintedMetal(PALETTE.botanicalDark));
    titleBack.position.set(0, 2.85, 0.7);
    group.add(titleBack);
    [0, Math.PI].forEach((rot) => {
      const logo = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62), plaqueMat);
      logo.position.set(Math.sin(rot) * 0.45, 1.75, Math.cos(rot) * 0.45);
      logo.rotation.y = rot;
      group.add(logo);
    });

    // Anillo luminoso flotante que rota lentamente
    this.halo = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.025, 12, 96), Materials.emissive(0x9ed4a8, 2.2));
    this.halo.position.y = 3.35;
    this.halo.rotation.x = Math.PI / 2;
    group.add(this.halo);
    this.totem = group;
  }

  // ---------------------------------------------------------------------------
  // Vegetación procedural (macetas cerámicas, rosetas de hojas, ficus low-poly)
  // ---------------------------------------------------------------------------
  buildPlants() {
    const { physics } = this.ctx;
    const leafGeo = new THREE.SphereGeometry(1, 10, 6);
    leafGeo.scale(0.08, 0.012, 0.32);
    leafGeo.translate(0, 0, 0.3);
    const greens = [0x3a5a40, 0x588157, 0x6a994e, 0x344e41];
    const potColors = [0xe9e3d8, 0x3a5a40, 0xc8b8a0];

    const addPlanter = (x, z, scale, kind, seed) => {
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      g.scale.setScalar(scale);
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.26, 0.6, 28), Materials.ceramic(potColors[seed % potColors.length]));
      pot.position.y = 0.3;
      pot.castShadow = pot.receiveShadow = true;
      const soil = new THREE.Mesh(new THREE.CircleGeometry(0.32, 24), new THREE.MeshStandardMaterial({ color: 0x3b2a1e, roughness: 1 }));
      soil.material.userData.disposable = true;
      soil.rotation.x = -Math.PI / 2;
      soil.position.y = 0.58;
      g.add(pot, soil);

      if (kind === 'rosette') {
        const count = 22;
        const leaves = new THREE.InstancedMesh(leafGeo, Materials.leaf(greens[seed % greens.length]), count);
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2 + seed;
          const tilt = -0.25 - (i % 3) * 0.28;
          e.set(tilt, a, 0, 'YXZ');
          q.setFromEuler(e);
          const s = 0.9 + ((i * 7 + seed) % 5) * 0.12;
          m.compose(new THREE.Vector3(0, 0.6, 0), q, new THREE.Vector3(s, s, s * 1.1));
          leaves.setMatrixAt(i, m);
        }
        leaves.castShadow = true;
        g.add(leaves);
      } else {
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 1.4, 8), Materials.toolWood());
        trunk.position.y = 1.25;
        trunk.castShadow = true;
        g.add(trunk);
        for (let i = 0; i < 7; i++) {
          const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32 + (i % 3) * 0.06, 1), Materials.leaf(greens[(seed + i) % greens.length]));
          const a = i * 2.1 + seed;
          blob.position.set(Math.cos(a) * 0.28, 1.75 + (i % 3) * 0.22, Math.sin(a) * 0.28);
          blob.castShadow = true;
          g.add(blob);
        }
      }
      this.root.add(g);
      physics.addStatic([RAPIER.ColliderDesc.cylinder(0.3 * scale, 0.34 * scale).setTranslation(x, 0.3 * scale, z)], { kind: 'static' });
    };

    // Plantas alrededor del espejo de agua y entre portales (dejando libres los accesos)
    const ring = [
      [-150, 'rosette'], [-125, 'tree'], [-95, 'rosette'], [-74, 'tree'], [-24, 'rosette'], [24, 'tree'],
      [74, 'rosette'], [95, 'tree'], [125, 'rosette'], [150, 'tree'], [180, 'rosette']
    ];
    ring.forEach(([deg, kind], i) => {
      const a = THREE.MathUtils.degToRad(deg - 90);
      addPlanter(Math.cos(a) * 7.9, Math.sin(a) * 7.9, 1 + (i % 3) * 0.15, kind, i);
    });
    [[-2.6, 1.6], [2.6, 1.4]].forEach(([x, z], i) => addPlanter(x, z, 0.8, 'rosette', i + 3));

    // Musgo/grama baja alrededor de la fuente
    const moss = new THREE.Mesh(new THREE.RingGeometry(1.75, 2.25, 64), new THREE.MeshStandardMaterial({ color: 0x4f6f45, roughness: 1 }));
    moss.material.userData.disposable = true;
    moss.rotation.x = -Math.PI / 2;
    moss.position.y = 0.006;
    moss.receiveShadow = true;
    this.root.add(moss);
  }

  // ---------------------------------------------------------------------------
  // Tablero de Récord Histórico
  // ---------------------------------------------------------------------------
  buildRecordBoard() {
    const { storage } = this.ctx;
    const board = new THREE.Group();
    board.position.set(-3.2, 0, 3.0);
    board.rotation.y = 0.75;
    this.root.add(board);

    const legMat = Materials.toolWood();
    [-0.62, 0.62].forEach((x) => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.9, 0.08), legMat);
      leg.position.set(x, 0.95, 0);
      leg.castShadow = true;
      board.add(leg);
    });
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.36, 1.0, 0.05), Materials.paintedMetal(PALETTE.botanicalDark));
    back.position.set(0, 1.45, 0);
    back.castShadow = true;
    board.add(back);

    const record = storage.getRecord('rageRoom');
    const stats = storage.stats;
    const panel = new TextPanel({
      width: 1.26, height: 0.9, pxPerMeter: 640, emissiveIntensity: 1.05,
      draw: (ctx, w, h) => {
        ctx.fillStyle = '#1B281E';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#3A5A40';
        ctx.lineWidth = 8;
        roundRect(ctx, 10, 10, w - 20, h - 20, 20);
        ctx.stroke();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#9ED4A8';
        fitText(ctx, 'RÉCORD HISTÓRICO', w / 2, h * 0.12, w * 0.85, 58, '800');
        ctx.fillStyle = '#F4F0EA';
        fitText(ctx, 'SALA DE DESCARGA', w / 2, h * 0.24, w * 0.8, 38, '600');
        ctx.fillStyle = '#E9C46A';
        fitText(ctx, record ? `${record.score.toLocaleString('es-AR')}` : '— — —', w / 2, h * 0.43, w * 0.85, 150, '900');
        ctx.fillStyle = '#c9d6c3';
        const date = record ? new Date(record.date).toLocaleDateString('es-AR') : 'Jugá tu primera ronda';
        fitText(ctx, record ? `PUNTOS · ${date}` : date, w / 2, h * 0.58, w * 0.8, 34, '600');
        ctx.fillStyle = '#F4F0EA';
        ctx.font = '600 30px system-ui, sans-serif';
        const lines = [
          `Rondas jugadas: ${stats.rounds}`,
          `Equipos destruidos: ${stats.devicesBroken}`,
          `Mejor combo: x${stats.bestCombo}`
        ];
        lines.forEach((l, i) => ctx.fillText(l, w / 2, h * (0.71 + i * 0.085)));
      }
    });
    panel.mesh.position.set(0, 1.45, 0.03);
    board.add(panel.mesh);

    this.ctx.physics.addStatic([RAPIER.ColliderDesc.cuboid(0.7, 0.95, 0.06)
      .setTranslation(board.position.x, 0.95, board.position.z)
      .setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), board.rotation.y))], { kind: 'static' });
  }

  // ---------------------------------------------------------------------------
  // Portales modulares (uno por entrada del registro de minijuegos)
  // ---------------------------------------------------------------------------
  buildPortals() {
    const { storage, physics } = this.ctx;
    const angles = [-48, 0, 48];
    MINIGAMES.slice(0, 3).forEach((entry, i) => {
      const portal = new Portal({
        entry,
        record: entry.recordKey ? storage.getRecord(entry.recordKey) : null,
        onEnter: (id) => this.ctx.goTo(id),
        physics,
        parentScene: this
      });
      const a = THREE.MathUtils.degToRad(angles[i] - 90);
      const r = 7.55;
      portal.root.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      portal.root.lookAt(0, 0, 0);
      this.root.add(portal.root);
      portal.buildColliders();
      this.portals.push(portal);
    });
  }

  isTeleportable(p) {
    const r = Math.hypot(p.x, p.z);
    return r < RADIUS - 0.6 && r > 1.9;
  }

  update(dt) {
    this.halo.rotation.z += dt * 0.25;
    this.halo.position.y = 3.35 + Math.sin(performance.now() * 0.0012) * 0.05;
    const head = this.ctx.getHeadPosition(new THREE.Vector3());
    for (const portal of this.portals) {
      if (portal.update(dt, head)) {
        this.ctx.goTo(portal.entry.id);
        break;
      }
    }
  }
}
