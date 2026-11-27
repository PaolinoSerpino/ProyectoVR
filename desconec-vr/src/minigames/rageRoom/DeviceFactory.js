import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { Materials } from '../../core/render/Materials.js';
import { getScreenTexture, ScreenController } from './ScreenUI.js';

/**
 * Fábrica de electrónica destructible. Cada equipo es un modelo compuesto PBR con:
 *  - mesh: Group con origen en la base (centro inferior), frente hacia +Z.
 *  - colliders: cajas compuestas (con masa real aproximada) para Rapier.
 *  - screens: controladores de pantalla (grietas / parpadeo).
 *  - screenUV(localPoint): mapea un impacto a coordenadas de pantalla.
 *  - makeFragments(impactLocal): receta de piezas físicas al romperse.
 */
export const DEVICE_SPECS = {
  monitor: { name: 'MONITOR', hp: 10, minSpeed: 3.0, value: 180, sparks: 45, glass: true },
  tower: { name: 'GABINETE', hp: 15, minSpeed: 3.6, value: 230, sparks: 70, glass: true },
  laptop: { name: 'NOTEBOOK', hp: 9, minSpeed: 3.0, value: 200, sparks: 35, glass: true },
  keyboard: { name: 'TECLADO', hp: 7, minSpeed: 3.4, value: 120, sparks: 0, glass: false },
  tablet: { name: 'TABLET', hp: 6, minSpeed: 3.4, value: 150, sparks: 16, glass: true },
  phone: { name: 'CELULAR', hp: 5, minSpeed: 3.8, value: 140, sparks: 12, glass: true }
};

const IDENTITY = new THREE.Quaternion();
const DENSITY = { plastic: 1100, metal: 2700, glass: 2500, pcb: 1850 };

// ---------------------------------------------------------------------------
// Materiales específicos (cacheados en módulo)
// ---------------------------------------------------------------------------
let _mats = null;
function mats() {
  if (_mats) return _mats;
  _mats = {
    blackPlastic: Materials.plastic(0x1c1d21, 0.45),
    greyPlastic: Materials.plastic(0x3a3d42, 0.5),
    whitePlastic: Materials.plastic(0xe8e6e1, 0.4),
    darkAlu: Materials.aluminium(0x2b2d31),
    silverAlu: Materials.aluminium(0xb9bdc2),
    spaceGrey: Materials.aluminium(0x5b5e63),
    chassis: Materials.paintedMetal(0x1e2124, [1, 1]),
    glass: Materials.glassShard(),
    sideGlass: new THREE.MeshPhysicalMaterial({ color: 0x2a3440, transparent: true, opacity: 0.32, roughness: 0.04, metalness: 0, clearcoat: 1, depthWrite: false }),
    pcb: Materials.pcb(),
    chip: Materials.chip(),
    led: Materials.emissive(0x4cc9f0, 3),
    rgbA: Materials.emissive(0xff3c8e, 2.6),
    rgbB: Materials.emissive(0x3cc9ff, 2.6),
    battery: Materials.plastic(0x2f6f9f, 0.5),
    keyDeck: keyDeckMaterial()
  };
  return _mats;
}

function keyDeckMaterial() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 160;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#26282c';
  ctx.fillRect(0, 0, 256, 160);
  ctx.fillStyle = '#0f1012';
  for (let r = 0; r < 5; r++) {
    for (let k = 0; k < 13; k++) ctx.fillRect(8 + k * 18.6, 10 + r * 20, 15, 16);
  }
  ctx.fillRect(70, 112, 116, 16);
  ctx.fillStyle = '#3a3d42';
  ctx.fillRect(88, 134, 80, 22);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0.1 });
}

// ---------------------------------------------------------------------------
// Helpers de construcción
// ---------------------------------------------------------------------------
function part(geo, mat, x, y, z, parent, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function collider(half, pos, mass, quat = null) {
  return { half, pos, mass, quat };
}

function screenMaterial(texture) {
  const m = Materials.screenGlass(texture);
  m.userData.disposable = true;
  return m;
}

// ---------------------------------------------------------------------------
// Helpers de fragmentación
// ---------------------------------------------------------------------------
function boxFragment(w, h, d, material, pos, quat = IDENTITY, kind = 'plastic', density = DENSITY.plastic) {
  return {
    geometry: new THREE.BoxGeometry(w, h, d),
    material,
    position: pos.clone(),
    quaternion: quat.clone(),
    collider: { type: 'cuboid', half: [w / 2, h / 2, d / 2] },
    mass: Math.max(0.01, w * h * d * density),
    kind
  };
}

/** Parte una caja en `pieces` losas con cortes aleatorios sobre su eje más largo. */
function splitBox(w, h, d, material, center, quat, pieces, kind, density) {
  const dims = [w, h, d];
  const axis = dims.indexOf(Math.max(w, h, d));
  const cuts = [0, 1];
  for (let i = 1; i < pieces; i++) cuts.push(i / pieces + (Math.random() - 0.5) * (0.5 / pieces));
  cuts.sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const t0 = cuts[i], t1 = cuts[i + 1];
    const size = dims.slice();
    size[axis] = dims[axis] * (t1 - t0);
    const offset = new THREE.Vector3();
    offset.setComponent(axis, dims[axis] * ((t0 + t1) / 2 - 0.5));
    offset.applyQuaternion(quat);
    out.push(boxFragment(size[0], size[1], size[2], material, center.clone().add(offset), quat, kind, density));
  }
  return out;
}

/**
 * Astillado radial de un panel de vidrio: abanico de triángulos desde el punto de impacto
 * hacia el borde, extruidos al espesor real; cada astilla tiene collider convex hull.
 */
function shatterPane(w, h, thickness, center, quat, uv, count, material) {
  const ix = (THREE.MathUtils.clamp(uv.x, 0.12, 0.88) - 0.5) * w;
  const iy = (THREE.MathUtils.clamp(uv.y, 0.12, 0.88) - 0.5) * h;
  const boundary = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
  for (let i = 0; i < count - 4; i++) {
    const t = Math.random();
    const side = i % 4;
    if (side === 0) boundary.push([-w / 2 + t * w, -h / 2]);
    else if (side === 1) boundary.push([w / 2, -h / 2 + t * h]);
    else if (side === 2) boundary.push([w / 2 - t * w, h / 2]);
    else boundary.push([-w / 2, h / 2 - t * h]);
  }
  boundary.sort((a, b) => Math.atan2(a[1] - iy, a[0] - ix) - Math.atan2(b[1] - iy, b[0] - ix));

  const shards = [];
  for (let i = 0; i < boundary.length; i++) {
    const p1 = boundary[i];
    const p2 = boundary[(i + 1) % boundary.length];
    const area = Math.abs((p1[0] - ix) * (p2[1] - iy) - (p2[0] - ix) * (p1[1] - iy)) / 2;
    if (area < 0.00015) continue;
    const cx = (ix + p1[0] + p2[0]) / 3, cy = (iy + p1[1] + p2[1]) / 3;
    const pts = [];
    [[ix, iy], p1, p2].forEach(([x, y]) => {
      pts.push(new THREE.Vector3(x - cx, y - cy, thickness / 2));
      pts.push(new THREE.Vector3(x - cx, y - cy, -thickness / 2));
    });
    const flat = new Float32Array(pts.length * 3);
    pts.forEach((p, k) => { flat[k * 3] = p.x; flat[k * 3 + 1] = p.y; flat[k * 3 + 2] = p.z; });
    shards.push({
      geometry: new ConvexGeometry(pts),
      material,
      position: center.clone().add(new THREE.Vector3(cx, cy, 0).applyQuaternion(quat)),
      quaternion: quat.clone(),
      collider: { type: 'hull', points: flat, fallbackHalf: [Math.max(0.005, w / 8), Math.max(0.005, h / 8), thickness / 2] },
      mass: Math.max(0.01, area * thickness * DENSITY.glass),
      kind: 'glass'
    });
  }
  return shards;
}

function pcbFragment(w, d, pos, quat) {
  const frag = boxFragment(w, 0.004, d, mats().pcb, pos, quat, 'pcb', DENSITY.pcb);
  frag.decorate = (mesh) => {
    const m = mats();
    for (let i = 0; i < 3; i++) {
      const chip = new THREE.Mesh(new THREE.BoxGeometry(w * 0.22, 0.004, d * 0.22), m.chip);
      chip.position.set((i - 1) * w * 0.3, 0.004, (i % 2 ? 0.2 : -0.2) * d);
      mesh.add(chip);
    }
  };
  return frag;
}

const rotX = (a) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), a);
const rotY = (a) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);
const rotZ = (a) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------------------
// Modelos
// ---------------------------------------------------------------------------
function buildMonitor(seed) {
  const m = mats();
  const g = new THREE.Group();
  const base = part(new THREE.CylinderGeometry(0.11, 0.12, 0.014, 36), m.darkAlu, 0, 0.007, 0.02, g);
  base.scale.z = 0.75;
  part(new THREE.BoxGeometry(0.045, 0.2, 0.022), m.darkAlu, 0, 0.11, -0.035, g);
  part(new THREE.BoxGeometry(0.56, 0.34, 0.03), m.blackPlastic, 0, 0.3, 0, g);
  part(new THREE.BoxGeometry(0.36, 0.22, 0.035), m.blackPlastic, 0, 0.29, -0.032, g);
  const tex = getScreenTexture('desktop', seed);
  const sMat = screenMaterial(tex);
  part(new THREE.PlaneGeometry(0.53, 0.305), sMat, 0, 0.305, 0.0152, g, false);
  part(new THREE.BoxGeometry(0.008, 0.006, 0.004), m.led, 0.25, 0.138, 0.016, g, false);

  return {
    mesh: g,
    colliders: [
      collider([0.28, 0.17, 0.016], [0, 0.3, 0], 2.6),
      collider([0.18, 0.11, 0.018], [0, 0.29, -0.032], 0.6),
      collider([0.0225, 0.1, 0.011], [0, 0.11, -0.035], 0.4),
      collider([0.11, 0.007, 0.085], [0, 0.007, 0.02], 1.3)
    ],
    screens: [new ScreenController(sMat, tex)],
    screenUV: (p) => ({ u: (p.x + 0.265) / 0.53, v: (p.y - 0.1525) / 0.305 }),
    makeFragments: (impact) => {
      const uv = { x: (impact.x + 0.265) / 0.53, y: (impact.y - 0.1525) / 0.305 };
      return [
        ...shatterPane(0.53, 0.305, 0.004, V(0, 0.305, 0.012), IDENTITY, uv, 8, m.glass),
        boxFragment(0.56, 0.026, 0.03, m.blackPlastic, V(0, 0.457, 0)),
        boxFragment(0.56, 0.034, 0.03, m.blackPlastic, V(0, 0.147, 0)),
        boxFragment(0.026, 0.28, 0.03, m.blackPlastic, V(-0.267, 0.3, 0)),
        boxFragment(0.026, 0.28, 0.03, m.blackPlastic, V(0.267, 0.3, 0)),
        ...splitBox(0.36, 0.22, 0.035, m.blackPlastic, V(0, 0.29, -0.032), IDENTITY, 2, 'plastic', DENSITY.plastic),
        pcbFragment(0.22, 0.12, V(0, 0.3, -0.01), rotX(Math.PI / 2)),
        boxFragment(0.045, 0.2, 0.022, m.darkAlu, V(0, 0.11, -0.035), IDENTITY, 'metal', DENSITY.metal),
        boxFragment(0.22, 0.014, 0.17, m.darkAlu, V(0, 0.007, 0.02), IDENTITY, 'metal', 1800)
      ];
    }
  };
}

function buildTower() {
  const m = mats();
  const g = new THREE.Group();
  [[-0.08, -0.17], [0.08, -0.17], [-0.08, 0.17], [0.08, 0.17]].forEach(([x, z]) => part(new THREE.BoxGeometry(0.03, 0.012, 0.05), m.blackPlastic, x, 0.006, z, g));
  part(new THREE.BoxGeometry(0.2, 0.42, 0.42), m.chassis, 0, 0.222, 0, g);
  part(new THREE.BoxGeometry(0.205, 0.42, 0.014), m.blackPlastic, 0, 0.222, 0.215, g);
  for (let i = 0; i < 6; i++) part(new THREE.BoxGeometry(0.15, 0.006, 0.004), m.greyPlastic, 0, 0.09 + i * 0.022, 0.223, g, false);
  part(new THREE.CylinderGeometry(0.012, 0.012, 0.006, 20), m.led, 0, 0.39, 0.224, g, false).rotation.x = Math.PI / 2;
  // Ventana lateral de vidrio con fans RGB, GPU y RAM visibles
  part(new THREE.BoxGeometry(0.004, 0.36, 0.36), m.sideGlass, 0.103, 0.24, 0, g, false);
  [[0.31, 0.1], [0.17, 0.1]].forEach(([y, z], i) => {
    const fan = part(new THREE.TorusGeometry(0.045, 0.006, 8, 28), i ? m.rgbB : m.rgbA, 0.07, y, z, g, false);
    fan.rotation.y = Math.PI / 2;
  });
  part(new THREE.BoxGeometry(0.04, 0.11, 0.24), m.blackPlastic, 0.04, 0.2, -0.04, g);
  part(new THREE.BoxGeometry(0.006, 0.12, 0.012), m.rgbB, 0.06, 0.33, -0.08, g, false);
  part(new THREE.BoxGeometry(0.006, 0.12, 0.012), m.rgbA, 0.06, 0.33, -0.1, g, false);

  return {
    mesh: g,
    colliders: [collider([0.1, 0.216, 0.215], [0, 0.222, 0], 8)],
    screens: [],
    screenUV: () => null,
    makeFragments: (impact) => {
      const uv = { x: (-impact.z + 0.18) / 0.36, y: (impact.y - 0.06) / 0.36 };
      return [
        ...shatterPane(0.36, 0.36, 0.004, V(0.103, 0.24, 0), rotY(Math.PI / 2), uv, 7, m.glass),
        boxFragment(0.006, 0.4, 0.4, m.chassis, V(-0.097, 0.222, 0), IDENTITY, 'metal', 2000),
        boxFragment(0.2, 0.006, 0.42, m.chassis, V(0, 0.43, 0), IDENTITY, 'metal', 2000),
        ...splitBox(0.205, 0.42, 0.014, m.blackPlastic, V(0, 0.222, 0.215), IDENTITY, 2, 'plastic', DENSITY.plastic),
        pcbFragment(0.3, 0.24, V(-0.08, 0.24, 0), rotZ(Math.PI / 2)),
        boxFragment(0.04, 0.11, 0.24, m.blackPlastic, V(0.04, 0.2, -0.04)),
        boxFragment(0.14, 0.08, 0.15, m.chassis, V(0, 0.05, -0.12), IDENTITY, 'metal', 900),
        boxFragment(0.006, 0.12, 0.012, m.rgbB, V(0.06, 0.33, -0.08), IDENTITY, 'pcb', DENSITY.pcb),
        boxFragment(0.006, 0.12, 0.012, m.rgbA, V(0.06, 0.33, -0.1), IDENTITY, 'pcb', DENSITY.pcb),
        boxFragment(0.012, 0.1, 0.1, m.rgbA, V(0.07, 0.31, 0.1), IDENTITY, 'plastic', 300)
      ];
    }
  };
}

function buildLaptop(seed) {
  const m = mats();
  const g = new THREE.Group();
  part(new THREE.BoxGeometry(0.34, 0.018, 0.24), m.spaceGrey, 0, 0.009, 0, g);
  const deck = part(new THREE.PlaneGeometry(0.3, 0.13), m.keyDeck, 0, 0.0185, -0.02, g, false);
  deck.rotation.x = -Math.PI / 2;
  const pad = part(new THREE.PlaneGeometry(0.1, 0.06), m.greyPlastic, 0, 0.0186, 0.075, g, false);
  pad.rotation.x = -Math.PI / 2;

  const lidAngle = -0.28;
  const hinge = V(0, 0.018, -0.118);
  const lid = new THREE.Group();
  lid.position.copy(hinge);
  lid.rotation.x = lidAngle;
  g.add(lid);
  part(new THREE.BoxGeometry(0.34, 0.225, 0.007), m.spaceGrey, 0, 0.1125, 0, lid);
  const tex = getScreenTexture('desktop', seed + 1);
  const sMat = screenMaterial(tex);
  part(new THREE.PlaneGeometry(0.31, 0.19), sMat, 0, 0.115, 0.0037, lid, false);

  const lidQuat = rotX(lidAngle);
  const lidCenter = hinge.clone().add(V(0, 0.1125, 0).applyQuaternion(lidQuat));
  return {
    mesh: g,
    colliders: [
      collider([0.17, 0.009, 0.12], [0, 0.009, 0], 1.3),
      collider([0.17, 0.1125, 0.0035], lidCenter.toArray(), 0.5, lidQuat)
    ],
    screens: [new ScreenController(sMat, tex)],
    screenUV: (p) => {
      const local = p.clone().sub(hinge).applyQuaternion(lidQuat.clone().invert());
      return { u: (local.x + 0.155) / 0.31, v: (local.y - 0.02) / 0.19 };
    },
    makeFragments: (impact) => {
      const local = impact.clone().sub(hinge).applyQuaternion(lidQuat.clone().invert());
      const uv = { x: (local.x + 0.155) / 0.31, y: (local.y - 0.02) / 0.19 };
      const screenCenter = hinge.clone().add(V(0, 0.115, 0.006).applyQuaternion(lidQuat));
      const keys = [];
      for (let i = 0; i < 7; i++) {
        keys.push(boxFragment(0.016, 0.006, 0.016, m.blackPlastic, V(-0.12 + Math.random() * 0.24, 0.022, -0.07 + Math.random() * 0.1), IDENTITY, 'key'));
      }
      return [
        ...shatterPane(0.31, 0.19, 0.003, screenCenter, lidQuat, uv, 7, m.glass),
        boxFragment(0.34, 0.225, 0.005, m.spaceGrey, lidCenter, lidQuat, 'metal', 1500),
        ...splitBox(0.34, 0.018, 0.24, m.spaceGrey, V(0, 0.009, 0), IDENTITY, 2, 'metal', 1500),
        boxFragment(0.2, 0.008, 0.08, m.battery, V(0, 0.01, 0.03), IDENTITY, 'plastic', 1800),
        ...keys
      ];
    }
  };
}

function buildKeyboard() {
  const m = mats();
  const g = new THREE.Group();
  part(new THREE.BoxGeometry(0.44, 0.02, 0.145), m.blackPlastic, 0, 0.01, 0, g);
  const keyGeo = new THREE.BoxGeometry(0.023, 0.01, 0.023);
  const cols = 14, rows = 5;
  const keys = new THREE.InstancedMesh(keyGeo, m.greyPlastic, cols * rows + 1);
  const mtx = new THREE.Matrix4();
  let n = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r === rows - 1 && c > 3 && c < 10) continue;
      mtx.makeTranslation(-0.182 + c * 0.028, 0.025, -0.054 + r * 0.027);
      keys.setMatrixAt(n++, mtx);
    }
  }
  mtx.compose(V(0, 0.025, 0.054), IDENTITY, V(6.6, 1, 1));
  keys.setMatrixAt(n++, mtx);
  keys.count = n;
  keys.castShadow = true;
  g.add(keys);

  return {
    mesh: g,
    colliders: [collider([0.22, 0.015, 0.0725], [0, 0.015, 0], 0.9)],
    screens: [],
    screenUV: () => null,
    makeFragments: () => {
      const caps = [];
      for (let i = 0; i < 12; i++) {
        caps.push(boxFragment(0.023, 0.01, 0.023, m.greyPlastic, V(-0.18 + Math.random() * 0.36, 0.026, -0.05 + Math.random() * 0.1), IDENTITY, 'key'));
      }
      return [...splitBox(0.44, 0.02, 0.145, m.blackPlastic, V(0, 0.01, 0), IDENTITY, 3, 'plastic', DENSITY.plastic), ...caps];
    }
  };
}

function buildSlate(seed, { w, d, t, mat, pieces, shards }) {
  const m = mats();
  const g = new THREE.Group();
  part(new THREE.BoxGeometry(w, t, d), mat, 0, t / 2, 0, g);
  const tex = getScreenTexture('mobile', seed);
  const sMat = screenMaterial(tex);
  const screen = part(new THREE.PlaneGeometry(w * 0.9, d * 0.9), sMat, 0, t + 0.0005, 0, g, false);
  screen.rotation.x = -Math.PI / 2;
  const cam = part(new THREE.CylinderGeometry(w * 0.07, w * 0.07, 0.003, 16), m.chip, -w * 0.3, -0.0012, -d * 0.38, g, false);
  cam.rotation.x = 0;

  const paneQuat = rotX(-Math.PI / 2);
  return {
    mesh: g,
    colliders: [collider([w / 2, t / 2, d / 2], [0, t / 2, 0], w * d * t * 2300)],
    screens: [new ScreenController(sMat, tex)],
    screenUV: (p) => ({ u: (p.x + w * 0.45) / (w * 0.9), v: (-p.z + d * 0.45) / (d * 0.9) }),
    makeFragments: (impact) => {
      const uv = { x: (impact.x + w * 0.45) / (w * 0.9), y: (-impact.z + d * 0.45) / (d * 0.9) };
      return [
        ...shatterPane(w * 0.92, d * 0.92, 0.002, V(0, t + 0.002, 0), paneQuat, uv, shards, m.glass),
        ...splitBox(w, t * 0.7, d, mat, V(0, t * 0.35, 0), IDENTITY, pieces, 'metal', 1600),
        boxFragment(w * 0.6, 0.004, d * 0.4, m.battery, V(0, t * 0.5, d * 0.1), IDENTITY, 'plastic', 1800),
        pcbFragment(w * 0.5, d * 0.25, V(0, t * 0.5, -d * 0.25), IDENTITY)
      ];
    }
  };
}

const BUILDERS = {
  monitor: (seed) => buildMonitor(seed),
  tower: () => buildTower(),
  laptop: (seed) => buildLaptop(seed),
  keyboard: () => buildKeyboard(),
  tablet: (seed) => buildSlate(seed, { w: 0.17, d: 0.245, t: 0.008, mat: mats().silverAlu, pieces: 2, shards: 6 }),
  phone: (seed) => buildSlate(seed + 2, { w: 0.075, d: 0.155, t: 0.009, mat: mats().darkAlu, pieces: 2, shards: 5 })
};

export function createDeviceModel(type, seed = 0) {
  const build = BUILDERS[type](seed);
  build.spec = DEVICE_SPECS[type];
  build.type = type;
  return build;
}
