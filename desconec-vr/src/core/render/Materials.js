import * as THREE from 'three';
import * as Tex from './ProceduralTextures.js';

/**
 * Biblioteca de materiales PBR. Las texturas procedurales se comparten (misma imagen)
 * y solo se clona el objeto Texture cuando cambia el `repeat`.
 */
const materialCache = new Map();

function withRepeat(set, repeat) {
  if (!repeat) return set;
  const clone = (t) => {
    const c = t.clone();
    c.repeat.set(repeat[0], repeat[1]);
    c.needsUpdate = true;
    return c;
  };
  return { map: clone(set.map), roughnessMap: clone(set.roughnessMap), normalMap: clone(set.normalMap) };
}

function cached(key, factory) {
  if (!materialCache.has(key)) materialCache.set(key, factory());
  return materialCache.get(key);
}

export const Materials = {
  concrete: (repeat = [4, 4]) => cached(`concrete-${repeat}`, () => new THREE.MeshStandardMaterial({
    ...withRepeat(Tex.concrete(), repeat), normalScale: new THREE.Vector2(0.9, 0.9), metalness: 0
  })),

  brick: (repeat = [3, 2]) => cached(`brick-${repeat}`, () => new THREE.MeshStandardMaterial({
    ...withRepeat(Tex.brick(), repeat), normalScale: new THREE.Vector2(1.2, 1.2), metalness: 0
  })),

  woodFloor: (repeat = [4, 4]) => cached(`wood-${repeat}`, () => new THREE.MeshStandardMaterial({
    ...withRepeat(Tex.woodPlanks(), repeat), normalScale: new THREE.Vector2(0.6, 0.6), metalness: 0
  })),

  plaster: (repeat = [4, 2]) => cached(`plaster-${repeat}`, () => new THREE.MeshStandardMaterial({
    ...withRepeat(Tex.plaster(), repeat), normalScale: new THREE.Vector2(0.5, 0.5), metalness: 0
  })),

  brushedSteel: (repeat = [1, 1]) => cached(`steel-${repeat}`, () => new THREE.MeshStandardMaterial({
    ...withRepeat(Tex.brushedMetal(), repeat), metalness: 1, normalScale: new THREE.Vector2(0.4, 0.4)
  })),

  paintedMetal: (hex = 0x2f3b36, repeat = [2, 2]) => cached(`painted-${hex}-${repeat}`, () => new THREE.MeshStandardMaterial({
    ...withRepeat(Tex.paintedMetal(61, hex), repeat), metalness: 0.65, normalScale: new THREE.Vector2(0.5, 0.5)
  })),

  toolWood: (repeat = [1, 1]) => cached(`toolwood-${repeat}`, () => new THREE.MeshStandardMaterial({
    ...withRepeat(Tex.toolWood(), repeat), metalness: 0, normalScale: new THREE.Vector2(0.5, 0.5)
  })),

  plastic: (hex, roughness = 0.55, repeat = [2, 2]) => cached(`plastic-${hex}-${roughness}-${repeat}`, () => {
    const set = withRepeat(Tex.texturedPlastic(), repeat);
    return new THREE.MeshStandardMaterial({
      color: hex, roughness, metalness: 0.02, roughnessMap: set.roughnessMap, normalMap: set.normalMap,
      normalScale: new THREE.Vector2(0.25, 0.25)
    });
  }),

  aluminium: (hex = 0xb9bdc2) => cached(`alu-${hex}`, () => {
    const set = Tex.brushedMetal(57);
    return new THREE.MeshStandardMaterial({
      color: hex, metalness: 0.9, roughness: 0.35, roughnessMap: set.roughnessMap, normalMap: set.normalMap,
      normalScale: new THREE.Vector2(0.15, 0.15)
    });
  }),

  /** Vidrio de pantalla reflectivo: clearcoat + emisión de la UI. */
  screenGlass: (map) => new THREE.MeshPhysicalMaterial({
    color: 0x0b0d10, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 1.15,
    metalness: 0.1, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.04, reflectivity: 0.6
  }),

  /** Fragmentos de vidrio sueltos. */
  glassShard: () => cached('glass-shard', () => new THREE.MeshPhysicalMaterial({
    color: 0x9fb4c4, metalness: 0, roughness: 0.05, transparent: true, opacity: 0.55,
    clearcoat: 1, side: THREE.DoubleSide, depthWrite: false
  })),

  pcb: () => cached('pcb', () => new THREE.MeshStandardMaterial({ color: 0x1f6b3a, roughness: 0.45, metalness: 0.25 })),

  chip: () => cached('chip', () => new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.35, metalness: 0.4 })),

  rubber: (hex = 0x1a1a1a) => cached(`rubber-${hex}`, () => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.92, metalness: 0 })),

  emissive: (hex, intensity = 2) => cached(`emissive-${hex}-${intensity}`, () => new THREE.MeshStandardMaterial({
    color: hex, emissive: hex, emissiveIntensity: intensity, roughness: 0.4
  })),

  leaf: (hex) => cached(`leaf-${hex}`, () => new THREE.MeshStandardMaterial({
    color: hex, roughness: 0.62, metalness: 0, side: THREE.DoubleSide
  })),

  ceramic: (hex) => cached(`ceramic-${hex}`, () => new THREE.MeshPhysicalMaterial({
    color: hex, roughness: 0.38, metalness: 0, clearcoat: 0.4, clearcoatRoughness: 0.3
  }))
};
