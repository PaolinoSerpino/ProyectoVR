/**
 * Constantes globales de Desconec-VR: paleta, físicas, interacción y grupos de colisión.
 */
export const PALETTE = {
  forest: 0x3a5a40,
  botanicalDark: 0x1b281e,
  sand: 0xf4f0ea,
  warmWood: 0xa97c50,
  leaf: 0x588157,
  sage: 0xa3b18a
};

export const PHYSICS = {
  gravity: -9.81,
  fixedStep: 1 / 120,
  maxSubSteps: 5,
  maxTrackingSpeed: 30,
  maxTrackingAngular: 60
};

export const INTERACTION = {
  grabRadius: 0.11,
  desktopReach: 2.6,
  velocitySamples: 8,
  throwSamples: 4,
  snapTurnDegrees: 30,
  teleportMaxDistance: 9
};

// Rapier usa grupos de 16 bits: (membresía << 16) | filtro.
export const GROUP = {
  STATIC: 1 << 0,
  DEVICE: 1 << 1,
  HELD: 1 << 2,
  FRAGMENT: 1 << 3,
  PROP: 1 << 4
};

export function interactionGroups(membership, filter) {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

export const ALL_GROUPS = 0xffff;
