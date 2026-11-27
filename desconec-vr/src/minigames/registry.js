import { RageRoom } from './rageRoom/RageRoom.js';

/**
 * Registro de minijuegos. El lobby crea un portal por entrada, en este orden.
 * Para sumar un minijuego: crear `src/minigames/<id>/` extendiendo BaseMinigame
 * y reemplazar una entrada `comingSoon` por `{ ...Clase.meta, create: () => new Clase() }`.
 */
export const MINIGAMES = [
  { ...RageRoom.meta, create: () => new RageRoom() },
  { id: 'proximamente-2', title: 'PRÓXIMAMENTE', subtitle: 'Nuevo minijuego en desarrollo', comingSoon: true },
  { id: 'proximamente-3', title: 'PRÓXIMAMENTE', subtitle: 'Nuevo minijuego en desarrollo', comingSoon: true }
];

export function findMinigame(id) {
  return MINIGAMES.find((m) => m.id === id && !m.comingSoon) || null;
}
