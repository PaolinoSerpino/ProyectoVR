import * as THREE from 'three';

/**
 * Generador de texturas PBR procedurales (sin assets externos).
 * Cada material produce: albedo (sRGB), rugosidad (lineal) y normal map derivado
 * de un mapa de alturas por diferencias finitas (Sobel).
 */

const SIZE = 512;
const cache = new Map();

// ---------------------------------------------------------------------------
// Ruido de valor con FBM (determinista por semilla)
// ---------------------------------------------------------------------------
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoise(seed, period = 64) {
  const rng = makeRng(seed);
  const grid = new Float32Array(period * period);
  for (let i = 0; i < grid.length; i++) grid[i] = rng();
  const smooth = (t) => t * t * (3 - 2 * t);
  // Ruido 2D tileable (período fijo => las texturas repiten sin costuras)
  const sample = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = smooth(x - xi), yf = smooth(y - yi);
    const x0 = ((xi % period) + period) % period, y0 = ((yi % period) + period) % period;
    const x1 = (x0 + 1) % period, y1 = (y0 + 1) % period;
    const a = grid[y0 * period + x0], b = grid[y0 * period + x1];
    const c = grid[y1 * period + x0], d = grid[y1 * period + x1];
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
  return (u, v, octaves = 4, baseFreq = 4) => {
    let amp = 0.5, freq = baseFreq, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += sample(u * freq, v * freq) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  };
}

// ---------------------------------------------------------------------------
// Utilidades de canvas
// ---------------------------------------------------------------------------
function makeCanvas(size = SIZE) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function heightToNormalCanvas(height, size, strength) {
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const at = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      let nx = -dx * strength, ny = dy * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * size + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function fieldToCanvas(size, fn) {
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b] = fn(x, y);
      const i = (y * size + x) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function toTexture(canvas, srgb) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** Construye el set PBR a partir de funciones (u,v) => {color:[r,g,b] 0..1, rough 0..1, height 0..1}. */
function buildSet(key, sample, normalStrength = 2.5, size = SIZE) {
  if (cache.has(key)) return cache.get(key);
  const albedo = new Uint8ClampedArray(size * size * 3);
  const rough = new Uint8ClampedArray(size * size);
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = sample(x / size, y / size, x, y);
      const i = y * size + x;
      albedo[i * 3] = s.color[0] * 255;
      albedo[i * 3 + 1] = s.color[1] * 255;
      albedo[i * 3 + 2] = s.color[2] * 255;
      rough[i] = s.rough * 255;
      height[i] = s.height;
    }
  }
  const set = {
    map: toTexture(fieldToCanvas(size, (x, y) => {
      const i = (y * size + x) * 3;
      return [albedo[i], albedo[i + 1], albedo[i + 2]];
    }), true),
    roughnessMap: toTexture(fieldToCanvas(size, (x, y) => {
      const v = rough[y * size + x];
      return [v, v, v];
    }), false),
    normalMap: toTexture(heightToNormalCanvas(height, size, normalStrength), false)
  };
  cache.set(key, set);
  return set;
}

const mix = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const hexRgb = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
const mixRgb = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

// ---------------------------------------------------------------------------
// Catálogo de superficies
// ---------------------------------------------------------------------------

/** Hormigón con poros, manchas de humedad y desgaste. */
export function concrete(seed = 11) {
  const n = makeNoise(seed), n2 = makeNoise(seed + 7), pores = makeNoise(seed + 13, 128);
  const base = hexRgb(0x8d8a84), dark = hexRgb(0x5d5a55), light = hexRgb(0xb3afa7);
  return buildSet(`concrete-${seed}`, (u, v) => {
    const f = n(u, v, 5, 3);
    const stain = clamp01((n2(u, v, 3, 2) - 0.55) * 3);
    const p = pores(u, v, 2, 48);
    const pore = p < 0.22 ? (0.22 - p) * 4 : 0;
    let c = mixRgb(dark, light, f);
    c = mixRgb(c, base, 0.35);
    c = mixRgb(c, hexRgb(0x4a473f), stain * 0.55);
    c = mixRgb(c, hexRgb(0x3c3a36), pore * 0.6);
    return { color: c, rough: clamp01(0.82 + f * 0.12 - stain * 0.25), height: f * 0.6 - pore * 0.5 };
  }, 3.2);
}

/** Ladrillo visto con juntas de mortero, variación cromática y bordes desgastados. */
export function brick(seed = 21) {
  const n = makeNoise(seed), chip = makeNoise(seed + 3, 128), tone = makeRng(seed + 5);
  const rows = 8, cols = 4, mortar = 0.06;
  const tones = Array.from({ length: rows * cols * 2 }, () => tone());
  return buildSet(`brick-${seed}`, (u, v) => {
    const row = Math.floor(v * rows);
    const offset = row % 2 ? 0.5 / cols : 0;
    const uu = (u + offset) % 1;
    const col = Math.floor(uu * cols);
    const bu = uu * cols - col, bv = v * rows - row;
    const edge = Math.min(bu, 1 - bu) * 2.0, edgeV = Math.min(bv, 1 - bv);
    const inMortar = edge < mortar || edgeV < mortar * 1.6;
    const t = tones[(row * cols + col) % tones.length];
    const f = n(u, v, 5, 6);
    if (inMortar) {
      const m = mixRgb(hexRgb(0x9a958c), hexRgb(0x7b766d), f);
      return { color: m, rough: 0.95, height: 0.1 + f * 0.05 };
    }
    let c = mixRgb(hexRgb(0x8e4a35), hexRgb(0xa9644a), t);
    c = mixRgb(c, hexRgb(0x5e2f22), clamp01(f - 0.45));
    const ch = chip(u, v, 3, 20);
    const chipped = ch < 0.25 ? (0.25 - ch) * 3 : 0;
    c = mixRgb(c, hexRgb(0x6f6a60), chipped * 0.5);
    return { color: c, rough: clamp01(0.78 + f * 0.15), height: 0.75 + f * 0.2 - chipped * 0.35 };
  }, 4.5);
}

/** Piso de madera cálida en tablas con veta. */
export function woodPlanks(seed = 31) {
  const n = makeNoise(seed), grain = makeNoise(seed + 9, 128), plank = makeRng(seed + 2);
  const planks = 6;
  const offsets = Array.from({ length: planks }, () => plank());
  const tones = Array.from({ length: planks * 3 }, () => plank());
  return buildSet(`wood-${seed}`, (u, v) => {
    const p = Math.floor(u * planks);
    const pu = u * planks - p;
    const segV = (v + offsets[p]) % 1;
    const seg = Math.floor(segV * 2);
    const seam = Math.min(pu, 1 - pu) < 0.02 || Math.abs(segV - 0.5) < 0.004 || segV < 0.004;
    const g = grain(pu * 0.3 + p * 0.17, v * 2.5, 4, 3);
    const rings = Math.sin((pu * 18 + g * 9) * Math.PI) * 0.5 + 0.5;
    const t = tones[(p * 2 + seg) % tones.length];
    let c = mixRgb(hexRgb(0x9c6b43), hexRgb(0xc0915f), t);
    c = mixRgb(c, hexRgb(0x7a4d2c), rings * 0.35 + (n(u, v, 3, 8) - 0.5) * 0.2);
    if (seam) c = mixRgb(c, hexRgb(0x3b2717), 0.85);
    return { color: c, rough: seam ? 0.9 : clamp01(0.48 + rings * 0.18), height: seam ? 0 : 0.6 + rings * 0.08 };
  }, 2.2);
}

/** Estuco/yeso arena del lobby botánico. */
export function plaster(seed = 41) {
  const n = makeNoise(seed), m = makeNoise(seed + 4);
  return buildSet(`plaster-${seed}`, (u, v) => {
    const f = n(u, v, 5, 5), g = m(u, v, 3, 2);
    const c = mixRgb(hexRgb(0xe9e3d8), hexRgb(0xf7f3ec), f * 0.7 + g * 0.3);
    return { color: c, rough: clamp01(0.86 + f * 0.1), height: f };
  }, 1.4);
}

/** Metal cepillado (estanterías, cabeza del martillo). */
export function brushedMetal(seed = 51) {
  const n = makeNoise(seed, 128), scratch = makeNoise(seed + 6, 128);
  return buildSet(`brushed-${seed}`, (u, v) => {
    const streak = n(u * 0.05, v * 8, 4, 16);
    const s = scratch(u, v, 2, 30);
    const sc = s > 0.8 ? (s - 0.8) * 4 : 0;
    const l = 0.62 + streak * 0.18 + sc * 0.15;
    return { color: [l, l, l * 1.02], rough: clamp01(0.32 + streak * 0.2 - sc * 0.15), height: streak * 0.5 + sc * 0.3 };
  }, 1.2);
}

/** Metal pintado con rayones y óxido leve (mesas industriales). */
export function paintedMetal(seed = 61, hex = 0x2f3b36) {
  const n = makeNoise(seed), scratch = makeNoise(seed + 2, 128), rust = makeNoise(seed + 8);
  const paint = hexRgb(hex);
  return buildSet(`painted-${seed}-${hex}`, (u, v) => {
    const f = n(u, v, 4, 6);
    const s = scratch(u * 3, v * 0.4, 2, 12);
    const sc = s > 0.78 ? (s - 0.78) * 4.5 : 0;
    const r = clamp01((rust(u, v, 3, 3) - 0.68) * 4);
    let c = mixRgb(paint, paint.map((x) => x * 0.8), f);
    c = mixRgb(c, hexRgb(0xa8a8a8), sc);
    c = mixRgb(c, hexRgb(0x6b3b1d), r * 0.7);
    return { color: c, rough: clamp01(0.55 + f * 0.15 + r * 0.3 - sc * 0.2), height: f * 0.3 - sc * 0.4 + r * 0.2 };
  }, 1.8);
}

/** Madera de mango de herramienta / cajones (veta longitudinal). */
export function toolWood(seed = 71) {
  const g = makeNoise(seed, 128);
  return buildSet(`toolwood-${seed}`, (u, v) => {
    const grain = g(u * 6, v * 0.6, 4, 6);
    const rings = Math.sin((u * 30 + grain * 6) * Math.PI) * 0.5 + 0.5;
    const c = mixRgb(hexRgb(0xb88a57), hexRgb(0x8a5d36), rings * 0.6);
    return { color: c, rough: 0.55 + rings * 0.2, height: rings * 0.4 };
  }, 1.6);
}

/** Plástico texturizado (carcasas). Albedo neutro: el color lo aporta material.color. */
export function texturedPlastic(seed = 81) {
  const n = makeNoise(seed, 128);
  return buildSet(`plastic-${seed}`, (u, v) => {
    const f = n(u, v, 3, 40);
    const l = 0.92 + f * 0.08;
    return { color: [l, l, l], rough: 0.5 + f * 0.2, height: f };
  }, 0.9, 256);
}
