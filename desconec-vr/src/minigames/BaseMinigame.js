import { BaseScene } from '../core/BaseScene.js';

/**
 * Interfaz base de todos los minijuegos de Desconec-VR.
 *
 * Cada minijuego vive en `src/minigames/<id>/`, se registra en `registry.js` y el lobby
 * genera automáticamente su portal. Debe implementar:
 *   - mount(ctx):    construir sala, objetos físicos y UI diegética (llamar a super.mount).
 *   - update(dt):    lógica por frame (reglas, puntaje, efectos).
 *   - unmount():     liberar recursos propios (llamar a super.unmount).
 *
 * `ctx` expone: scene, camera, rig, physics, grab, audio, storage, popups, hands,
 * isXR(), getHeadPosition(), goTo(sceneId) y renderer.
 */
export class BaseMinigame extends BaseScene {
  /** Metadatos para el portal del lobby y la tabla de récords. */
  static meta = {
    id: 'base',
    title: 'MINIJUEGO',
    subtitle: '',
    recordKey: 'base'
  };

  constructor() {
    super(new.target.meta.id);
    this.meta = new.target.meta;
  }

  /** Volver al lobby desde el minijuego (botón físico o B/Y del mando). */
  exitToLobby() {
    this.ctx?.goTo('lobby');
  }
}
