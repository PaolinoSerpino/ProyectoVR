import * as THREE from 'three';
import { BaseMinigame } from '../BaseMinigame.js';
import { PhysicalButton } from '../../core/ui/PhysicalButton.js';
import { buildRoom, ROOM, FURNITURE } from './RoomBuilder.js';
import { Device } from './Device.js';
import { DebrisSystem } from './DebrisSystem.js';
import { Effects } from './Effects.js';
import { Hammer } from './Hammer.js';
import { ScoreSystem } from './ScoreSystem.js';
import { Scoreboard } from './Scoreboard.js';

const ROUND_SECONDS = 90;
const RECORD_KEY = 'rageRoom';

/**
 * MINIJUEGO 1 — "SALA DE DESCARGA" (Rage Room realista).
 * Todo responde a la física: agarrar con grip, revolear con la velocidad real de la mano y
 * reventar equipos a martillazos. El daño sale de la velocidad relativa del impacto medida
 * por Rapier, y el puntaje del estilo con que se rompió cada equipo.
 */
export class RageRoom extends BaseMinigame {
  static meta = {
    id: 'rageRoom',
    title: 'SALA DE DESCARGA',
    subtitle: 'Minijuego 1 · Rage Room',
    recordKey: RECORD_KEY
  };

  constructor() {
    super();
    this.environment = 'studio';
    this.exposure = 0.95;
    this.background = new THREE.Color(0x0d0e10);
    this.spawn = { position: new THREE.Vector3(0, 0, 2.7), yaw: 0 };
    this.devices = [];
    this.state = 'ready';
    this.timeLeft = ROUND_SECONDS;
    this.clock = 0;
    this.unsubs = [];
  }

  async mount(ctx) {
    await super.mount(ctx);
    const { physics, grab } = ctx;

    this.layout = buildRoom(ctx, this.root);
    this.effects = new Effects(this.root);
    this.debris = new DebrisSystem({ physics, root: this.root });
    this.score = new ScoreSystem();

    // Marcador LED + botones físicos de pared
    this.scoreboard = new Scoreboard();
    this.scoreboard.root.position.copy(this.layout.scoreboardPosition);
    this.root.add(this.scoreboard.root);

    this.addButton(this.placeButton(new PhysicalButton({
      label: 'REINICIAR SALA', sublabel: 'REPONER EQUIPOS', color: 0xc0392b, radius: 0.1,
      onPress: () => this.resetRoom()
    }), this.layout.resetButtonPosition, 0));
    [[this.layout.lobbyButtonNorthPosition, 0], [this.layout.lobbyButtonSouthPosition, Math.PI]].forEach(([pos, rot]) => {
      this.addButton(this.placeButton(new PhysicalButton({
        label: 'VOLVER AL LOBBY', sublabel: 'DESCONEC-VR', color: 0x2e8b57, radius: 0.08,
        onPress: () => this.exitToLobby()
      }), pos, rot));
    });

    this.spawnProps();

    this.unsubs.push(
      physics.onImpact((impact) => this.onImpact(impact)),
      grab.on('grab', (e) => this.onGrab(e)),
      grab.on('release', (e) => this.onRelease(e))
    );
    this.setReady();
  }

  placeButton(button, position, rotationY) {
    button.root.position.copy(position);
    button.root.rotation.y = rotationY;
    return button;
  }

  unmount() {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.devices.forEach((d) => d.dispose());
    this.devices = [];
    this.debris.clear();
    super.unmount();
  }

  // ---------------------------------------------------------------------------
  // Equipos y martillo
  // ---------------------------------------------------------------------------
  spawnProps() {
    const { physics } = this.ctx;
    const { tables, shelves, bench, crates } = FURNITURE;
    const t1 = tables[0], t2 = tables[1], t3 = tables[2];
    const s1 = shelves[0], s2 = shelves[1];
    const H = Math.PI / 2;
    const layout = [
      // Mesa 1
      ['monitor', t1.x - 0.4, t1.top, t1.z - 0.2, 0.15],
      ['keyboard', t1.x - 0.35, t1.top, t1.z + 0.2, 0],
      ['laptop', t1.x + 0.42, t1.top, t1.z - 0.05, -0.3],
      ['phone', t1.x + 0.2, t1.top, t1.z + 0.25, 0.4],
      // Mesa 2
      ['monitor', t2.x - 0.36, t2.top, t2.z - 0.2, -0.1],
      ['monitor', t2.x + 0.38, t2.top, t2.z - 0.22, -0.3],
      ['keyboard', t2.x - 0.15, t2.top, t2.z + 0.22, 0.05],
      ['tablet', t2.x + 0.55, t2.top, t2.z + 0.2, 0.2],
      // Mesa 3
      ['tower', t3.x - 0.5, t3.top, t3.z - 0.1, 0.3],
      ['laptop', t3.x + 0.25, t3.top, t3.z - 0.08, 0.2],
      ['phone', t3.x + 0.6, t3.top, t3.z + 0.25, 1.0],
      // Estanterías (frente hacia +X)
      ['tower', s1.x, s1.levels[0], s1.z - 0.2, H],
      ['monitor', s1.x - 0.05, s1.levels[1], s1.z, H],
      ['tablet', s1.x, s1.levels[2], s1.z - 0.25, H],
      ['phone', s1.x, s1.levels[2], s1.z + 0.3, H],
      ['tower', s2.x, s2.levels[0], s2.z + 0.15, H],
      ['laptop', s2.x - 0.02, s2.levels[1], s2.z, H],
      ['keyboard', s2.x, s2.levels[2], s2.z, H],
      // Cajones
      ['monitor', crates[0].x, crates[0].size * crates[0].stack, crates[0].z, -H + 0.3],
      ['tower', crates[1].x, crates[1].size, crates[1].z, -0.6],
      // Banco de trabajo
      ['phone', bench.x - 0.1, bench.top, bench.z - 0.45, 0.3]
    ];
    layout.forEach(([type, x, y, z, yaw], i) => {
      const device = new Device(type, i);
      device.spawn(physics, this.root, new THREE.Vector3(x, y + 0.002, z), yaw);
      this.devices.push(device);
    });

    if (!this.hammer) {
      const quat = new THREE.Quaternion()
        .setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2)
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2));
      this.hammer = new Hammer({ physics, root: this.root, position: new THREE.Vector3(bench.x - 0.05, bench.top + 0.04, bench.z + 0.35), quaternion: quat });
    }
  }

  resetRoom() {
    const { grab } = this.ctx;
    grab.releaseAll();
    this.devices.forEach((d) => d.dispose());
    this.devices = [];
    this.debris.clear();
    this.effects.clear();
    this.hammer.resetHome();
    this.spawnProps();
    this.ctx.audio.play('chime', this.scoreboard.root.position, { intensity: 0.7 });
    this.setReady();
  }

  // ---------------------------------------------------------------------------
  // Ronda
  // ---------------------------------------------------------------------------
  setReady() {
    this.state = 'ready';
    this.timeLeft = ROUND_SECONDS;
    this.score.reset();
    this.lastTick = null;
    this.updateBoard('AGARRÁ EL MARTILLO O UN EQUIPO PARA EMPEZAR', '#F4F0EA');
  }

  startRound() {
    this.state = 'playing';
    this.timeLeft = ROUND_SECONDS;
    this.score.reset();
    this.ctx.audio.play('combo', this.scoreboard.root.position, { intensity: 1 });
    this.updateBoard('¡A DESCARGAR! ROMPÉ TODO CON ESTILO', '#38F07A');
  }

  endRound() {
    this.state = 'ended';
    const { storage, audio } = this.ctx;
    const finalScore = this.score.score;
    audio.play('buzzer', this.scoreboard.root.position, { intensity: 1 });
    storage.addStats({ rounds: 1, devicesBroken: this.score.broken, bestCombo: this.score.bestCombo, playSeconds: ROUND_SECONDS });
    const { isRecord } = storage.submitScore(RECORD_KEY, finalScore, { bestCombo: this.score.bestCombo, broken: this.score.broken });

    if (isRecord && finalScore > 0) {
      setTimeout(() => audio.play('fanfare', this.scoreboard.root.position, { intensity: 1 }), 600);
      const p = this.scoreboard.root.position.clone().add(new THREE.Vector3(0, 0, 0.3));
      this.effects.goldBurst(p, 160);
      this.ctx.popups.spawn(p.clone().add(new THREE.Vector3(0, -0.9, 0.4)), '¡NUEVO RÉCORD!', `${finalScore.toLocaleString('es-AR')} PTS`, '#E9C46A', 1.6);
      this.updateBoard(`¡NUEVO RÉCORD! ${finalScore.toLocaleString('es-AR')} · BOTÓN ROJO = OTRA RONDA`, '#E9C46A');
    } else {
      this.updateBoard(`FIN DE RONDA: ${finalScore.toLocaleString('es-AR')} PTS · BOTÓN ROJO = OTRA RONDA`, '#FF9F1C');
    }
  }

  updateBoard(status, statusColor) {
    const record = this.ctx.storage.getRecord(RECORD_KEY);
    this.scoreboard.set({
      time: this.timeLeft,
      score: this.score.score,
      combo: this.score.combo,
      multiplier: this.score.multiplier,
      record: record ? record.score : 0,
      comboLeft: this.score.comboTimeLeft(this.clock),
      ...(status ? { status, statusColor } : {})
    });
  }

  // ---------------------------------------------------------------------------
  // Eventos de agarre (estado de lanzamiento para bonos)
  // ---------------------------------------------------------------------------
  onGrab({ object }) {
    if (this.state === 'ready') this.startRound();
    const device = object.userData.device;
    if (device) {
      device.thrown = null;
      device.airborne = false;
    }
  }

  onRelease({ object, position, speed }) {
    const device = object.userData.device;
    if (device) device.markThrown(position, speed);
  }

  // ---------------------------------------------------------------------------
  // Impactos → sonido, hápticos, daño y rotura
  // ---------------------------------------------------------------------------
  onImpact(impact) {
    const { a, b, speed, point } = impact;
    if (speed < 0.5) return;
    const hammerHandle = a.userData.isHammer ? impact.colliderA : b.userData.isHammer ? impact.colliderB : null;
    const headHit = hammerHandle !== null && this.hammer.isHead(hammerHandle);

    this.playImpactSound(a, b, speed, point, headHit);

    // Háptica en la mano que sostiene cualquiera de los dos cuerpos
    [a, b].forEach((o) => {
      const hand = o.userData.heldBy;
      if (hand && speed > 0.8) hand.pulse(Math.min(1, 0.15 + speed / 9), Math.min(90, 15 + speed * 7));
    });

    // Las masas se leen antes: un lado puede romperse (y salir del mundo físico) antes que el otro
    const massA = a.isStatic ? Infinity : a.mass;
    const massB = b.isStatic ? Infinity : b.mass;
    const sides = [
      [a, b, impact.colliderB, impact.relVel.clone().negate(), massA, massB],
      [b, a, impact.colliderA, impact.relVel.clone(), massB, massA]
    ];
    for (const [self, other, otherHandle, otherRelVel, selfMass, otherMass] of sides) {
      const device = self.userData.device;
      if (!device || device.broken) continue;

      let by = 'other';
      let hardness = 0.5;
      let surface = null;
      if (other.userData.isHammer) {
        by = 'hammer';
        hardness = this.hammer.isHead(otherHandle) ? 2.8 : 1.0;
      } else if (other.isStatic) {
        by = 'static';
        hardness = 1.6;
        surface = other.userData.surface || null;
      } else if (other.userData.device) {
        by = 'device';
        hardness = THREE.MathUtils.clamp(otherMass / Math.max(0.05, selfMass), 0.4, 2.5);
        // Un equipo en movimiento que impacta a otro inicia/extiende una reacción en cadena
        if (other.preLin.length() > Math.max(2, self.preLin.length())) {
          this.score.linkChain(other.userData.device, device, this.clock);
        }
      } else if (other.userData.fragment) {
        hardness = speed > 8 ? 0.25 : 0;
      }

      const damage = hardness > 0 ? device.applyImpact(speed, hardness, point) : 0;
      if (device.shouldBreak) {
        const direction = by === 'static'
          ? device.getCenter(new THREE.Vector3()).sub(point).normalize().add(new THREE.Vector3(0, 0.6, 0))
          : otherRelVel;
        this.breakDevice(device, {
          by, speed, point, direction, surface,
          headHit: by === 'hammer' && hardness > 2,
          floor: by === 'static' && (Math.abs(impact.normal.y) > 0.7 && point.y < 0.2)
        });
      } else if (damage > 0) {
        this.effects.sparkBurst(point, Math.min(12, Math.round(damage * 2)), otherRelVel.clone().normalize(), 0.4);
        if (device.spec.glass) this.ctx.audio.play('debris', point, { intensity: Math.min(1, speed / 10), pitch: 1.4 });
      }
      if (by === 'static' || by === 'device') device.landed();
    }
  }

  playImpactSound(a, b, speed, point, headHit) {
    const { audio } = this.ctx;
    const intensity = THREE.MathUtils.clamp(speed / 10, 0.05, 1);
    const isFrag = a.userData.fragment || b.userData.fragment;
    if (isFrag) {
      if (speed < 1.2) return;
      const glass = a.userData.kind === 'glass' || b.userData.kind === 'glass';
      audio.play('debris', point, { intensity: intensity * 0.8, pitch: glass ? 1.6 : 1 });
      return;
    }
    if (a.userData.isHammer || b.userData.isHammer) {
      audio.play('metalClang', point, { intensity: headHit ? intensity : intensity * 0.5, pitch: headHit ? 1 : 1.3 });
    }
    const stat = a.isStatic ? a : b.isStatic ? b : null;
    if (stat) {
      const surface = stat.userData.surface;
      if (surface === 'metal') audio.play('knock', point, { intensity, pitch: 1.45 });
      else if (surface === 'wood') audio.play('knock', point, { intensity });
      else audio.play('thud', point, { intensity });
    }
    if (a.userData.device || b.userData.device) audio.play('plasticTap', point, { intensity });
  }

  breakDevice(device, cause) {
    const { grab, audio, popups } = this.ctx;
    const heldBy = device.obj.userData.heldBy;
    if (heldBy) grab.forget(device.obj);
    const hammerHand = this.hammer.heldBy;

    const center = cause.point.clone();
    device.shatter(this.debris, { point: cause.point, direction: cause.direction, speed: cause.speed });

    // Efectos: chispas con destello, humo de cortocircuito, polvo de plástico
    const power = Math.min(1, cause.speed / 12);
    if (device.spec.sparks) {
      this.effects.sparkBurst(center, Math.round(device.spec.sparks * (0.6 + power)), cause.direction.clone().normalize(), 0.7 + power);
      this.effects.puff(center, { smoke: true, count: 2, size: 0.3 });
      setTimeout(() => audio.play('spark', center, { intensity: 0.6 + power * 0.4 }), 40);
    }
    this.effects.puff(center, { smoke: false, count: 3, size: 0.22 });
    if (device.spec.glass) audio.play('glass', center, { intensity: 0.5 + power * 0.5 });
    audio.play('plastic', center, { intensity: 0.5 + power * 0.5 });
    if (device.model.screens.length) setTimeout(() => audio.play('powerDown', center, { intensity: 0.6 }), 90);

    // Háptica fuerte de rotura
    if (cause.by === 'hammer' && hammerHand) hammerHand.pulse(1, 110);
    if (heldBy) heldBy.pulse(0.9, 120);

    this.devices = this.devices.filter((d) => d !== device);

    if (this.state !== 'playing') {
      if (this.state === 'ready') {
        this.startRound();
      } else {
        popups.spawn(center, 'RONDA TERMINADA', 'Botón rojo: nueva ronda', '#9a9a9a', 0.8);
        return;
      }
    }

    const result = this.score.registerBreak({
      device, by: cause.by, speed: cause.speed, headHit: cause.headHit, floor: cause.floor, surface: cause.surface, point: cause.point, now: this.clock
    });
    const main = result.styles[result.styles.length - 1];
    const subtitle = main ? main.label : result.combo > 1 ? `COMBO x${result.multiplier.toFixed(1)}` : device.name;
    popups.spawn(center, `+${result.points}`, subtitle, main ? main.color : '#FFD166', main ? 1.25 : 1);
    result.styles.slice(0, -1).forEach((st, i) => {
      popups.spawn(center.clone().add(new THREE.Vector3(0, 0.35 + i * 0.25, 0)), st.label, '', st.color, 0.8);
    });
    if (result.combo > 1) audio.play('combo', center, { intensity: 0.6, pitch: 1 + Math.min(0.6, result.combo * 0.08) });
    this.updateBoard(result.combo > 1 ? `COMBO x${result.multiplier.toFixed(1)} · ¡SEGUÍ ASÍ!` : '¡A DESCARGAR! ROMPÉ TODO CON ESTILO', result.combo > 1 ? '#4CC9F0' : '#38F07A');
  }

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------
  update(dt) {
    this.clock += dt;
    if (this.state === 'playing') {
      this.timeLeft -= dt;
      const sec = Math.ceil(this.timeLeft);
      if (sec <= 10 && sec > 0 && sec !== this.lastTick) {
        this.lastTick = sec;
        this.ctx.audio.play('tick', this.scoreboard.root.position, { intensity: 0.8 });
      }
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.endRound();
      }
    }
    this.updateBoard();
    this.scoreboard.update(dt);
    this.devices.forEach((d) => d.update(dt));
    this.debris.update(dt);
    this.effects.update(dt);
    this.hammer.update({ x: ROOM.halfX + 0.5, z: ROOM.halfZ + 0.5 });
  }

  isTeleportable(p) {
    return Math.abs(p.x) < ROOM.halfX - 0.35 && Math.abs(p.z) < ROOM.halfZ - 0.35 && p.y < 0.2;
  }

  getButtonProbes() {
    return this.hammer?.heldBy ? [this.hammer.getHeadWorld(new THREE.Vector3())] : [];
  }
}
