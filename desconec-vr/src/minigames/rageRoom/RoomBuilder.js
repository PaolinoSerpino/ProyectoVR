import * as THREE from 'three';
import { RAPIER } from '../../core/physics/PhysicsWorld.js';
import { Materials } from '../../core/render/Materials.js';
import { TextPanel, fitText } from '../../core/ui/TextPanel.js';

/**
 * Construcción de la "Sala de Descarga": arquitectura, iluminación industrial y mobiliario,
 * con sus colisionadores estáticos. Las superficies se etiquetan (`surface`) para elegir
 * el sonido de cada choque (hormigón, ladrillo, metal, madera).
 */
export const ROOM = { halfX: 4.5, halfZ: 3.8, height: 3.6 };

export const FURNITURE = {
  tables: [
    { x: -2.2, z: -0.9, top: 0.8 },
    { x: 2.2, z: -0.9, top: 0.8 },
    { x: -1.8, z: 1.7, top: 0.8 }
  ],
  shelves: [
    { x: -4.15, z: -2.2, levels: [0.42, 1.02, 1.62] },
    { x: -4.15, z: 0.6, levels: [0.42, 1.02, 1.62] }
  ],
  bench: { x: 1.6, z: 1.9, top: 0.92 },
  crates: [
    { x: 3.85, z: -2.7, size: 0.6, stack: 2 },
    { x: 3.15, z: -2.95, size: 0.6, stack: 1 }
  ],
  exitDoor: { x: -2.6 }
};

export function buildRoom(ctx, root) {
  const { physics } = ctx;
  const { halfX, halfZ, height } = ROOM;

  const addMesh = (geo, mat, x, y, z, { cast = true, receive = true, rx = 0, ry = 0, rz = 0 } = {}) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = cast;
    m.receiveShadow = receive;
    root.add(m);
    return m;
  };
  const staticBox = (x, y, z, hx, hy, hz, surface, quat = null) => {
    const d = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setFriction(0.8).setRestitution(0.1);
    if (quat) d.setRotation(quat);
    return physics.addStatic([d], { kind: 'static', surface });
  };

  // --- Piso de hormigón pulido con manchas ---
  addMesh(new THREE.PlaneGeometry(halfX * 2, halfZ * 2), Materials.concrete([5, 4]), 0, 0, 0, { rx: -Math.PI / 2, cast: false });
  staticBox(0, -0.15, 0, halfX + 1, 0.15, halfZ + 1, 'concrete');

  // --- Muros: ladrillo (norte/este) y hormigón (sur/oeste) ---
  const brickNS = Materials.brick([5, 2.6]);
  const brickEW = Materials.brick([4.2, 2.6]);
  const concreteWall = Materials.concrete([4, 2]);
  addMesh(new THREE.PlaneGeometry(halfX * 2, height), brickNS, 0, height / 2, -halfZ, { cast: false });
  addMesh(new THREE.PlaneGeometry(halfZ * 2, height), brickEW, halfX, height / 2, 0, { ry: -Math.PI / 2, cast: false });
  addMesh(new THREE.PlaneGeometry(halfX * 2, height), concreteWall, 0, height / 2, halfZ, { ry: Math.PI, cast: false });
  addMesh(new THREE.PlaneGeometry(halfZ * 2, height), concreteWall, -halfX, height / 2, 0, { ry: Math.PI / 2, cast: false });
  staticBox(0, height / 2, -halfZ - 0.2, halfX + 0.4, height / 2 + 0.3, 0.2, 'brick');
  staticBox(0, height / 2, halfZ + 0.2, halfX + 0.4, height / 2 + 0.3, 0.2, 'concrete');
  staticBox(halfX + 0.2, height / 2, 0, 0.2, height / 2 + 0.3, halfZ + 0.4, 'brick');
  staticBox(-halfX - 0.2, height / 2, 0, 0.2, height / 2 + 0.3, halfZ + 0.4, 'concrete');

  // Zócalo de franjas de seguridad sobre el muro norte
  const stripeTex = hazardTexture();
  const stripeMat = new THREE.MeshStandardMaterial({ map: stripeTex, roughness: 0.7 });
  stripeMat.userData.disposable = true;
  addMesh(new THREE.PlaneGeometry(halfX * 2, 0.18), stripeMat, 0, 0.09, -halfZ + 0.005, { cast: false });

  // --- Techo, vigas doble T y conducto de ventilación ---
  addMesh(new THREE.PlaneGeometry(halfX * 2, halfZ * 2), Materials.concrete([4, 3]), 0, height, 0, { rx: Math.PI / 2, cast: false });
  staticBox(0, height + 0.15, 0, halfX + 0.4, 0.15, halfZ + 0.4, 'concrete');
  const steel = Materials.paintedMetal(0x3b4246, [2, 1]);
  for (let x = -3; x <= 3; x += 2) {
    addMesh(new THREE.BoxGeometry(0.14, 0.26, halfZ * 2), steel, x, height - 0.13, 0);
    addMesh(new THREE.BoxGeometry(0.22, 0.02, halfZ * 2), steel, x, height - 0.255, 0);
  }
  const duct = addMesh(new THREE.CylinderGeometry(0.22, 0.22, halfX * 2, 24, 1, true), Materials.brushedSteel([6, 1]), 0, height - 0.5, -halfZ + 0.5, { rz: Math.PI / 2 });
  duct.material = duct.material.clone();
  duct.material.side = THREE.DoubleSide;
  duct.material.userData.disposable = true;
  const pipeMat = Materials.paintedMetal(0x6b2d22, [1, 4]);
  [0.45, 0.6].forEach((y, i) => addMesh(new THREE.CylinderGeometry(0.035, 0.035, halfZ * 2, 12), pipeMat, halfX - 0.12 - i * 0.12, height - y, 0, { rx: Math.PI / 2 }));

  // --- Iluminación industrial cálida/neutra ---
  root.add(new THREE.HemisphereLight(0xcfd6db, 0x2b2622, 0.55));
  const fill = new THREE.PointLight(0xffe7c7, 6, 12, 2);
  fill.position.set(0, height - 0.6, 0.6);
  root.add(fill);

  // 5 lámparas visibles pero solo 3 SpotLights reales (2 con sombra): presupuesto de luces para VR móvil
  const lampSpots = [
    { x: -2.2, z: -0.9, light: true, shadow: true },
    { x: 2.2, z: -0.9, light: true, shadow: true },
    { x: -1.8, z: 1.7, light: false },
    { x: 1.6, z: 1.9, light: false },
    { x: -3.9, z: -0.8, light: false }
  ];
  const shadeMat = Materials.paintedMetal(0x2f4a37, [1, 1]);
  const bulbMat = Materials.emissive(0xffd9a0, 6);
  lampSpots.forEach(({ x, z, light, shadow }) => {
    const lampY = height - 0.85;
    addMesh(new THREE.CylinderGeometry(0.006, 0.006, 0.85, 6), Materials.rubber(0x111111), x, height - 0.425, z, { cast: false });
    const shade = addMesh(new THREE.ConeGeometry(0.26, 0.2, 28, 1, true), shadeMat, x, lampY, z);
    shade.material = shadeMat;
    addMesh(new THREE.SphereGeometry(0.055, 16, 12), bulbMat, x, lampY - 0.07, z, { cast: false });

    if (!light) return;
    const spot = new THREE.SpotLight(0xffe2b5, 38, 7, 0.95, 0.65, 2);
    spot.position.set(x, lampY - 0.08, z);
    spot.target.position.set(x, 0, z);
    if (shadow) {
      spot.castShadow = true;
      spot.shadow.mapSize.set(1024, 1024);
      spot.shadow.bias = -0.0005;
      spot.shadow.normalBias = 0.02;
      spot.shadow.camera.near = 0.2;
      spot.shadow.camera.far = 6;
    }
    root.add(spot, spot.target);
  });
  // Spot amplio que cubre la mesa 3, el banco de trabajo y la estantería
  const wide = new THREE.SpotLight(0xffe2b5, 42, 9, 1.15, 0.8, 2);
  wide.position.set(0, height - 0.3, 1.6);
  wide.target.position.set(-0.6, 0, 1.2);
  root.add(wide, wide.target);

  // --- Mesas metálicas de trabajo ---
  const tableTop = Materials.brushedSteel([2, 1]);
  const tableFrame = Materials.paintedMetal(0x2f3b36, [1, 1]);
  FURNITURE.tables.forEach(({ x, z, top }) => {
    const w = 1.6, d = 0.85, t = 0.04;
    addMesh(new THREE.BoxGeometry(w, t, d), tableTop, x, top - t / 2, z);
    addMesh(new THREE.BoxGeometry(w - 0.1, 0.06, d - 0.1), tableFrame, x, top - t - 0.03, z);
    addMesh(new THREE.BoxGeometry(w - 0.12, 0.025, d - 0.12), tableFrame, x, 0.18, z);
    staticBox(x, top - t / 2, z, w / 2, t / 2, d / 2, 'metal');
    staticBox(x, 0.18, z, (w - 0.12) / 2, 0.0125, (d - 0.12) / 2, 'metal');
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
      const lx = x + sx * (w / 2 - 0.05), lz = z + sz * (d / 2 - 0.05);
      addMesh(new THREE.BoxGeometry(0.05, top - t, 0.05), tableFrame, lx, (top - t) / 2, lz);
      staticBox(lx, (top - t) / 2, lz, 0.025, (top - t) / 2, 0.025, 'metal');
    });
  });

  // --- Estanterías metálicas contra el muro oeste ---
  const shelfMat = Materials.paintedMetal(0x4a5056, [1, 1]);
  FURNITURE.shelves.forEach(({ x, z, levels }) => {
    const w = 0.45, d = 1.2, postH = 1.95;
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
      const px = x + sx * (w / 2 - 0.02), pz = z + sz * (d / 2 - 0.02);
      addMesh(new THREE.BoxGeometry(0.04, postH, 0.04), shelfMat, px, postH / 2, pz);
      staticBox(px, postH / 2, pz, 0.02, postH / 2, 0.02, 'metal');
    });
    levels.forEach((y) => {
      addMesh(new THREE.BoxGeometry(w, 0.025, d), shelfMat, x, y - 0.0125, z);
      staticBox(x, y - 0.0125, z, w / 2, 0.0125, d / 2, 'metal');
      // Labio frontal para que lo apoyado no se deslice solo
      addMesh(new THREE.BoxGeometry(0.01, 0.03, d), shelfMat, x + w / 2 - 0.005, y + 0.015, z);
    });
  });

  // --- Cajones de madera ---
  const crateMat = Materials.toolWood([2, 2]);
  FURNITURE.crates.forEach(({ x, z, size, stack }) => {
    for (let i = 0; i < stack; i++) {
      const y = size / 2 + i * size;
      const crate = addMesh(new THREE.BoxGeometry(size, size, size), crateMat, x, y, z, { ry: i * 0.12 });
      crate.rotation.y = i * 0.12;
      for (let s = -1; s <= 1; s += 2) {
        addMesh(new THREE.BoxGeometry(size + 0.01, 0.07, size + 0.01), Materials.toolWood([1, 1]), x, y + s * size * 0.32, z, { ry: i * 0.12, cast: false });
      }
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), i * 0.12);
      staticBox(x, y, z, size / 2, size / 2, size / 2, 'wood', q);
    }
  });

  // --- Banco de trabajo con tapa de madera (aquí descansa el martillo) ---
  const { bench } = FURNITURE;
  const bw = 0.75, bd = 1.6;
  addMesh(new THREE.BoxGeometry(bw, 0.06, bd), Materials.toolWood([1, 3]), bench.x, bench.top - 0.03, bench.z);
  staticBox(bench.x, bench.top - 0.03, bench.z, bw / 2, 0.03, bd / 2, 'wood');
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
    const lx = bench.x + sx * (bw / 2 - 0.05), lz = bench.z + sz * (bd / 2 - 0.05);
    addMesh(new THREE.BoxGeometry(0.07, bench.top - 0.06, 0.07), tableFrame, lx, (bench.top - 0.06) / 2, lz);
    staticBox(lx, (bench.top - 0.06) / 2, lz, 0.035, (bench.top - 0.06) / 2, 0.035, 'metal');
  });
  // Morsa decorativa
  const vise = addMesh(new THREE.BoxGeometry(0.14, 0.1, 0.2), Materials.paintedMetal(0x2b5d8a), bench.x + 0.2, bench.top + 0.05, bench.z - 0.65);
  staticBox(vise.position.x, vise.position.y, vise.position.z, 0.07, 0.05, 0.1, 'metal');

  // --- Puerta de salida (muro sur) ---
  const doorX = FURNITURE.exitDoor.x;
  addMesh(new THREE.BoxGeometry(1.1, 2.2, 0.06), Materials.paintedMetal(0x2f4a37, [1, 2]), doorX, 1.1, halfZ - 0.03);
  addMesh(new THREE.BoxGeometry(1.26, 2.3, 0.04), steel, doorX, 1.15, halfZ - 0.005, { cast: false });
  addMesh(new THREE.BoxGeometry(0.2, 0.03, 0.04), Materials.brushedSteel(), doorX + 0.38, 1.05, halfZ - 0.08);
  const exitSign = new TextPanel({
    width: 0.7, height: 0.2, pxPerMeter: 700, emissiveIntensity: 2.2,
    draw: (c, w, h) => {
      c.fillStyle = '#0f5f2c';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#e9ffe9';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      fitText(c, 'SALIDA → LOBBY', w / 2, h / 2, w * 0.9, 80, '900');
    }
  });
  exitSign.mesh.position.set(doorX, 2.45, halfZ - 0.02);
  exitSign.mesh.rotation.y = Math.PI;
  root.add(exitSign.mesh);

  // Cartel estarcido en el muro oeste
  const stencil = new TextPanel({
    width: 2.6, height: 0.6, pxPerMeter: 400, emissive: false, transparent: true,
    draw: (c, w, h) => {
      c.fillStyle = '#7f7a72';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#1b1b1b';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      fitText(c, 'SALA DE DESCARGA', w / 2, h * 0.45, w * 0.94, 190, '900', 'Impact, "Arial Black", sans-serif');
      c.fillStyle = '#b23a2b';
      fitText(c, 'DESCONEC-VR · ZONA DE IMPACTO', w / 2, h * 0.86, w * 0.7, 46, '800');
    }
  });
  stencil.mesh.material.transparent = false;
  stencil.mesh.material.roughness = 0.95;
  stencil.mesh.position.set(-halfX + 0.01, 2.65, -0.8);
  stencil.mesh.rotation.y = Math.PI / 2;
  root.add(stencil.mesh);

  return {
    scoreboardPosition: new THREE.Vector3(0, 2.35, -halfZ + 0.06),
    resetButtonPosition: new THREE.Vector3(0.85, 1.25, -halfZ + 0.01),
    lobbyButtonNorthPosition: new THREE.Vector3(-0.85, 1.25, -halfZ + 0.01),
    lobbyButtonSouthPosition: new THREE.Vector3(doorX + 1.0, 1.25, halfZ - 0.01)
  };
}

function hazardTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 32;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, 512, 32);
  ctx.fillStyle = '#e0b000';
  for (let x = -32; x < 512; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 32);
    ctx.lineTo(x + 16, 32);
    ctx.lineTo(x + 32, 0);
    ctx.lineTo(x + 16, 0);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(6, 1);
  return t;
}
