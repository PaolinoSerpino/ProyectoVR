import * as THREE from 'three';

/**
 * Motor de audio espacial 3D.
 * - Los sonidos se sintetizan UNA vez con OfflineAudioContext (ruido filtrado, parciales
 *   inarmónicos, envolventes) → AudioBuffers realistas sin descargar samples.
 * - Cada reproducción usa un PositionalAudio (panner HRTF) de un pool fijo de voces.
 * - `intensity` (0..1, derivada de la velocidad del impacto) modula volumen, pitch y un
 *   filtro pasa-bajos: golpes suaves suenan apagados, golpes fuertes brillantes y fuertes.
 */
export class AudioEngine {
  constructor(camera, scene) {
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);
    this.ctx = this.listener.context;
    this.buffers = new Map();
    this.voices = [];
    this.voiceIndex = 0;
    this.ready = false;
    this.root = new THREE.Group();
    this.root.name = 'audio-voices';
    scene.add(this.root);
    this.lastPlay = new Map();

    for (let i = 0; i < 28; i++) {
      const voice = new THREE.PositionalAudio(this.listener);
      voice.setRefDistance(1.2);
      voice.setRolloffFactor(1.4);
      voice.setDistanceModel('inverse');
      voice.panner.panningModel = 'HRTF';
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 18000;
      voice.setFilter(filter);
      voice.userData.filter = filter;
      this.root.add(voice);
      this.voices.push(voice);
    }
    this.master = this.listener.getInput();
  }

  async resume() {
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  async init() {
    const sr = 44100;
    const jobs = Object.entries(SOUND_DESIGNS).map(async ([name, design]) => {
      const offline = new OfflineAudioContext(1, Math.ceil(design.duration * sr), sr);
      design.build(offline, new Synth(offline));
      this.buffers.set(name, await offline.startRendering());
    });
    await Promise.all(jobs);
    this.ready = true;
  }

  /**
   * @param {string} name
   * @param {THREE.Vector3|null} position null → sonido de interfaz pegado al oyente
   * @param {{intensity?: number, pitch?: number, volume?: number}} opts
   */
  play(name, position, opts = {}) {
    if (!this.ready || this.ctx.state !== 'running') return;
    const buffer = this.buffers.get(name);
    if (!buffer) return;

    // Evita apilar el mismo sonido en el mismo frame (ej. 10 fragmentos tocando el piso)
    const now = this.ctx.currentTime;
    const minGap = SOUND_DESIGNS[name].minGap ?? 0.03;
    if (now - (this.lastPlay.get(name) || 0) < minGap) return;
    this.lastPlay.set(name, now);

    const intensity = THREE.MathUtils.clamp(opts.intensity ?? 0.6, 0, 1);
    const voice = this.nextVoice();
    if (voice.isPlaying) voice.stop();
    voice.setBuffer(buffer);

    const design = SOUND_DESIGNS[name];
    const gain = (design.gain ?? 1) * (opts.volume ?? 1) * (0.25 + 0.75 * intensity);
    voice.setVolume(gain);
    const pitchVar = 1 + (Math.random() - 0.5) * (design.pitchVariance ?? 0.12);
    voice.setPlaybackRate((opts.pitch ?? 1) * pitchVar * (1 + (intensity - 0.5) * (design.pitchByForce ?? 0)));
    voice.userData.filter.frequency.setValueAtTime(900 + 17000 * Math.pow(intensity, 1.4), now);

    if (position) {
      voice.position.copy(position);
      voice.setRefDistance(1.2);
    } else {
      this.listener.getWorldPosition(voice.position);
    }
    voice.updateMatrixWorld();
    voice.play();
  }

  nextVoice() {
    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[(this.voiceIndex + i) % this.voices.length];
      if (!v.isPlaying) {
        this.voiceIndex = (this.voiceIndex + i + 1) % this.voices.length;
        return v;
      }
    }
    const v = this.voices[this.voiceIndex];
    this.voiceIndex = (this.voiceIndex + 1) % this.voices.length;
    return v;
  }
}

/** Utilidades de síntesis sobre un OfflineAudioContext. */
class Synth {
  constructor(ctx) {
    this.ctx = ctx;
    this.out = ctx.destination;
    this._noise = null;
  }

  noiseBuffer() {
    if (this._noise) return this._noise;
    const len = this.ctx.sampleRate * 2;
    const b = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._noise = b;
    return b;
  }

  /** Ráfaga de ruido filtrado con envolvente exponencial. */
  noise({ at = 0, dur = 0.1, type = 'bandpass', freq = 2000, q = 1, gain = 0.5, attack = 0.001, sweepTo = null }) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer();
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, at);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, at + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(gain, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f).connect(g).connect(this.out);
    src.start(at, Math.random());
    src.stop(at + dur + 0.02);
  }

  /** Oscilador con envolvente y glissando opcional. */
  tone({ at = 0, dur = 0.3, type = 'sine', freq = 440, to = null, gain = 0.3, attack = 0.002 }) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    if (to) o.frequency.exponentialRampToValueAtTime(to, at + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(gain, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(this.out);
    o.start(at);
    o.stop(at + dur + 0.02);
  }
}

const rand = (a, b) => a + Math.random() * (b - a);

/** Diseños sonoros (duración + grafo de síntesis). */
const SOUND_DESIGNS = {
  // Vidrio de pantalla estallando: transitorio + decenas de tintineos agudos que caen
  glass: {
    duration: 1.3, gain: 1.0, pitchByForce: 0.1,
    build: (_c, s) => {
      s.noise({ dur: 0.08, type: 'highpass', freq: 2500, gain: 0.9 });
      s.noise({ dur: 0.35, type: 'bandpass', freq: 5200, q: 0.8, gain: 0.45 });
      for (let i = 0; i < 26; i++) {
        const at = Math.pow(Math.random(), 1.8) * 1.0;
        s.tone({ at, dur: rand(0.04, 0.22), freq: rand(2600, 7800), gain: rand(0.03, 0.12) });
        if (i % 3 === 0) s.noise({ at, dur: 0.03, type: 'highpass', freq: 4000, gain: 0.15 });
      }
    }
  },
  // Carcasa plástica crujiendo/partiéndose
  plastic: {
    duration: 0.45, gain: 0.95, pitchByForce: -0.1,
    build: (_c, s) => {
      s.tone({ dur: 0.12, freq: 190, to: 90, gain: 0.5, type: 'triangle' });
      let t = 0;
      for (let i = 0; i < 12; i++) {
        t += rand(0.004, 0.035);
        s.noise({ at: t, dur: rand(0.008, 0.03), type: 'bandpass', freq: rand(900, 3200), q: 2.2, gain: rand(0.25, 0.6) });
      }
    }
  },
  // Golpe leve de plástico (empujar, rebotar)
  plasticTap: {
    duration: 0.15, gain: 0.6, minGap: 0.05,
    build: (_c, s) => {
      s.noise({ dur: 0.05, type: 'bandpass', freq: 1500, q: 1.5, gain: 0.5 });
      s.tone({ dur: 0.08, freq: 320, to: 180, gain: 0.25, type: 'triangle' });
    }
  },
  // Cabeza metálica del martillo: parciales inarmónicos de placa/barra
  metalClang: {
    duration: 1.4, gain: 0.9, pitchByForce: 0.05,
    build: (_c, s) => {
      s.noise({ dur: 0.03, type: 'highpass', freq: 1800, gain: 0.8 });
      const f0 = 410;
      [[1, 0.35, 1.3], [2.76, 0.22, 0.9], [5.4, 0.14, 0.6], [8.93, 0.08, 0.35], [13.3, 0.05, 0.2]].forEach(([m, g, d]) => {
        s.tone({ freq: f0 * m, dur: d, gain: g });
      });
    }
  },
  // Choque contra hormigón / piso
  thud: {
    duration: 0.5, gain: 1.0, pitchByForce: -0.15, minGap: 0.04,
    build: (_c, s) => {
      s.tone({ dur: 0.28, freq: 95, to: 42, gain: 0.8 });
      s.noise({ dur: 0.18, type: 'lowpass', freq: 900, gain: 0.7 });
      s.noise({ dur: 0.06, type: 'bandpass', freq: 2400, q: 1, gain: 0.2 });
    }
  },
  // Golpe en madera / mesa
  knock: {
    duration: 0.3, gain: 0.8, minGap: 0.05,
    build: (_c, s) => {
      s.tone({ dur: 0.16, freq: 240, to: 150, gain: 0.5, type: 'triangle' });
      s.noise({ dur: 0.07, type: 'bandpass', freq: 1200, q: 2, gain: 0.4 });
    }
  },
  // Fragmentos pequeños (teclas, astillas) rebotando
  debris: {
    duration: 0.12, gain: 0.45, minGap: 0.025, pitchVariance: 0.5,
    build: (_c, s) => {
      s.noise({ dur: 0.04, type: 'bandpass', freq: 3200, q: 3, gain: 0.5 });
      s.tone({ dur: 0.05, freq: 1800, gain: 0.08 });
    }
  },
  // Chispazo eléctrico + zumbido de cortocircuito
  spark: {
    duration: 0.8, gain: 0.8,
    build: (_c, s) => {
      s.tone({ dur: 0.35, freq: 120, to: 60, gain: 0.25, type: 'sawtooth' });
      let t = 0;
      for (let i = 0; i < 22; i++) {
        t += Math.pow(Math.random(), 2) * 0.05;
        s.noise({ at: t, dur: rand(0.004, 0.018), type: 'highpass', freq: rand(3000, 7000), gain: rand(0.3, 0.8) });
      }
    }
  },
  // Pantalla que se apaga
  powerDown: {
    duration: 0.7, gain: 0.5,
    build: (_c, s) => {
      s.tone({ dur: 0.6, freq: 560, to: 38, gain: 0.25, type: 'sawtooth' });
      s.tone({ dur: 0.2, freq: 9000, to: 3000, gain: 0.03 });
    }
  },
  whoosh: {
    duration: 0.45, gain: 0.55, pitchByForce: 0.3,
    build: (_c, s) => {
      s.noise({ dur: 0.4, type: 'bandpass', freq: 400, sweepTo: 2600, q: 0.9, gain: 0.5, attack: 0.12 });
    }
  },
  grab: {
    duration: 0.12, gain: 0.45,
    build: (_c, s) => {
      s.noise({ dur: 0.06, type: 'bandpass', freq: 900, q: 1.2, gain: 0.4 });
      s.tone({ dur: 0.06, freq: 520, to: 700, gain: 0.08 });
    }
  },
  button: {
    duration: 0.2, gain: 0.7,
    build: (_c, s) => {
      s.noise({ dur: 0.02, type: 'highpass', freq: 3000, gain: 0.6 });
      s.tone({ at: 0.03, dur: 0.06, freq: 1200, gain: 0.15, type: 'square' });
      s.noise({ at: 0.09, dur: 0.02, type: 'highpass', freq: 2500, gain: 0.4 });
    }
  },
  combo: {
    duration: 0.35, gain: 0.5, pitchVariance: 0,
    build: (_c, s) => {
      [660, 880, 1320].forEach((f, i) => s.tone({ at: i * 0.06, dur: 0.14, freq: f, gain: 0.18, type: 'triangle' }));
    }
  },
  tick: {
    duration: 0.08, gain: 0.5, pitchVariance: 0,
    build: (_c, s) => s.tone({ dur: 0.06, freq: 1500, gain: 0.25, type: 'square' })
  },
  buzzer: {
    duration: 1.0, gain: 0.7, pitchVariance: 0,
    build: (_c, s) => {
      s.tone({ dur: 0.9, freq: 196, gain: 0.25, type: 'sawtooth', attack: 0.02 });
      s.tone({ dur: 0.9, freq: 147, gain: 0.2, type: 'square', attack: 0.02 });
    }
  },
  fanfare: {
    duration: 2.0, gain: 0.7, pitchVariance: 0,
    build: (_c, s) => {
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => {
        s.tone({ at: i * 0.11, dur: 0.5, freq: f, gain: 0.16, type: 'triangle' });
        s.tone({ at: i * 0.11, dur: 0.5, freq: f * 2, gain: 0.04 });
      });
      [523.25, 659.25, 783.99, 1046.5].forEach((f) => s.tone({ at: 0.65, dur: 1.3, freq: f, gain: 0.1, attack: 0.05 }));
    }
  },
  portal: {
    duration: 1.4, gain: 0.6, pitchVariance: 0,
    build: (_c, s) => {
      s.noise({ dur: 1.3, type: 'bandpass', freq: 200, sweepTo: 3000, q: 1.5, gain: 0.4, attack: 0.5 });
      s.tone({ dur: 1.3, freq: 220, to: 660, gain: 0.12, attack: 0.4 });
    }
  },
  chime: {
    duration: 2.2, gain: 0.5, pitchVariance: 0.02,
    build: (_c, s) => {
      [523.25, 783.99, 1046.5].forEach((f, i) => s.tone({ at: i * 0.18, dur: 1.8, freq: f, gain: 0.1 }));
    }
  }
};
