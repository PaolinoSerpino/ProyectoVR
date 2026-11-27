import * as THREE from 'three';
import { Renderer } from './render/Renderer.js';
import { PhysicsWorld } from './physics/PhysicsWorld.js';
import { GrabSystem } from './vr/GrabSystem.js';
import { XRHand } from './vr/XRHand.js';
import { Locomotion } from './vr/Locomotion.js';
import { DesktopControls } from './input/DesktopControls.js';
import { AudioEngine } from './audio/AudioEngine.js';
import { Storage } from './storage/Storage.js';
import { Popups3D } from './ui/Popups3D.js';
import { Fader } from './ui/Fader.js';
import { LobbyScene } from '../scenes/lobby/LobbyScene.js';
import { findMinigame } from '../minigames/registry.js';

/**
 * Orquestador de Desconec-VR:
 * loop XR/PC → entrada → objetivos de agarre → física de paso fijo → sync de mallas →
 * lógica de escena → botones físicos → popups/fundido → render.
 */
export class App {
  constructor(container) {
    this.renderer = new Renderer(container);
    const r = this.renderer.renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.03, 120);
    this.camera.position.set(0, 1.6, 0);
    this.rig = new THREE.Group();
    this.rig.name = 'player-rig';
    this.rig.add(this.camera);
    this.scene.add(this.rig);
    this.renderer.onResizeCallback = () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    };

    this.physics = new PhysicsWorld();
    this.audio = new AudioEngine(this.camera, this.scene);
    this.storage = new Storage();
    this.grab = new GrabSystem({ physics: this.physics, audio: this.audio });
    this.popups = new Popups3D(this.scene);
    this.fader = new Fader(this.camera);

    // --- Entrada WebXR (mandos / manos) ---
    this.xrHands = [new XRHand(r, 0, this.rig), new XRHand(r, 1, this.rig)];
    this.xrHands.forEach((h) => this.grab.addHand(h));
    this.locomotion = new Locomotion({
      rig: this.rig,
      physics: this.physics,
      getHeadPosition: (out) => this.getHeadPosition(out),
      onMoved: () => this.grab.onRigMoved()
    });
    this.locomotion.attach(this.scene);
    this.lobbyHold = 0;

    // --- Modo prueba PC (separado del código XR) ---
    this.desktop = new DesktopControls({
      camera: this.camera,
      rig: this.rig,
      domElement: r.domElement,
      physics: this.physics,
      grab: this.grab,
      getInteractables: () => this.current?.buttons || [],
      onBackToLobby: () => this.goTo('lobby')
    });
    this.grab.addHand(this.desktop.hand);

    this.current = null;
    this.transitioning = false;
    this.timer = new THREE.Timer();
    this.elapsed = 0;

    this.ctx = {
      app: this,
      renderer: r,
      scene: this.scene,
      camera: this.camera,
      rig: this.rig,
      physics: this.physics,
      grab: this.grab,
      audio: this.audio,
      storage: this.storage,
      popups: this.popups,
      hands: [...this.xrHands, this.desktop.hand],
      isXR: () => r.xr.isPresenting,
      getHeadPosition: (out) => this.getHeadPosition(out),
      goTo: (id) => this.goTo(id),
      getEnvironment: (kind) => this.renderer.getEnvironment(kind)
    };

    r.xr.addEventListener('sessionstart', () => {
      this.desktop.setEnabled(false);
      this.camera.position.set(0, 0, 0);
      this.camera.rotation.set(0, 0, 0);
    });
    r.xr.addEventListener('sessionend', () => {
      this.grab.releaseAll();
      this.onXRSessionEnd?.();
    });
  }

  /** En XR three copia la pose del visor a la cámara de usuario, así que sirve en ambos modos. */
  getHeadPosition(out = new THREE.Vector3()) {
    return this.camera.getWorldPosition(out);
  }

  /** Conjunto de manos activas según el modo. */
  activeHands() {
    return this.renderer.renderer.xr.isPresenting ? this.xrHands.filter((h) => h.connected) : [this.desktop.hand];
  }

  async start(initialScene = 'lobby') {
    await this.audio.init();
    // El loop debe correr antes de montar: el fundido de entrada se anima dentro del loop
    this.renderer.renderer.setAnimationLoop((t, frame) => this.loop(t, frame));
    await this.goTo(initialScene, { instant: true });
  }

  createScene(id) {
    if (id === 'lobby') return new LobbyScene();
    const entry = findMinigame(id);
    return entry ? entry.create() : null;
  }

  /** Transición con fundido: suelta objetos, desmonta, resetea la física y monta la nueva escena. */
  async goTo(id, { instant = false } = {}) {
    if (this.transitioning || this.current?.id === id) return;
    const next = this.createScene(id);
    if (!next) return;
    this.transitioning = true;
    if (!instant) {
      this.audio.play('portal', null, { intensity: 0.8 });
      await this.fader.fadeTo(1, 0.35);
    }

    this.grab.releaseAll();
    this.locomotion.hideArc();
    if (this.current) this.current.unmount();
    this.physics.reset();
    this.popups.clear();

    this.scene.background = next.background;
    this.scene.fog = next.fog;
    this.scene.environment = this.renderer.getEnvironment(next.environment);
    this.renderer.renderer.toneMappingExposure = next.exposure;
    await next.mount(this.ctx);
    this.current = next;

    this.rig.position.copy(next.spawn.position);
    this.rig.rotation.set(0, next.spawn.yaw, 0);
    this.rig.updateMatrixWorld(true);
    this.locomotion.setTeleportFilter((p) => next.isTeleportable(p));
    this.desktop.syncFromRig();
    this.activeHands().forEach((h) => h.tracker.reset());

    await this.fader.fadeTo(0, instant ? 0.6 : 0.45);
    this.transitioning = false;
  }

  loop(time, frame) {
    this.timer.update(time);
    const dt = Math.min(this.timer.getDelta(), 0.05);
    this.elapsed += dt;
    const r = this.renderer.renderer;
    const xr = r.xr.isPresenting;

    this.rig.updateMatrixWorld(true);

    // 1) Entrada y tracking de velocidades reales
    if (xr) {
      const refSpace = r.xr.getReferenceSpace();
      this.xrHands.forEach((h) => h.update(dt, frame, refSpace));
      if (!this.transitioning) this.locomotion.update(dt, this.xrHands);
      this.updateLobbyShortcut(dt);
    } else {
      this.desktop.update(dt);
    }

    // 2) Agarre: pose objetivo de cada mano → 3) física de paso fijo (subpasos interpolados)
    this.grab.update();
    this.physics.step(dt);
    this.physics.syncMeshes();

    // 4) Lógica de escena + botones físicos presionables por manos / martillo
    if (this.current && !this.transitioning) {
      this.current.update(dt, this.elapsed);
      const probes = [];
      if (xr) this.xrHands.forEach((h) => h.connected && probes.push(h.getGrabPoint(new THREE.Vector3())));
      probes.push(...this.current.getButtonProbes());
      this.current.buttons.forEach((b) => b.update(dt, probes));
    }

    this.popups.update(dt);
    this.fader.update(dt);
    r.render(this.scene, this.camera);
  }

  /** Mantener B/Y (0.8 s) en un minijuego → volver al lobby (sin teclado). */
  updateLobbyShortcut(dt) {
    if (this.current?.id === 'lobby' || this.transitioning) {
      this.lobbyHold = 0;
      return;
    }
    const pressing = this.xrHands.find((h) => h.connected && h.isButtonPressed(5));
    if (pressing) {
      this.lobbyHold += dt;
      if (Math.floor(this.lobbyHold * 10) % 2 === 0) pressing.pulse(0.1, 10);
      if (this.lobbyHold > 0.8) {
        this.lobbyHold = 0;
        pressing.pulse(0.6, 80);
        this.goTo('lobby');
      }
    } else {
      this.lobbyHold = 0;
    }
  }
}
