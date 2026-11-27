/**
 * Persistencia local de récords y estadísticas de Desconec-VR.
 * Estructura versionada en una sola clave de localStorage.
 */
const KEY = 'desconec-vr.v1';

const DEFAULT_DATA = () => ({
  records: {},
  stats: { sessions: 0, rounds: 0, devicesBroken: 0, bestCombo: 0, playSeconds: 0 }
});

export class Storage {
  constructor() {
    this.data = this.load();
    this.data.stats.sessions += 1;
    this.save();
  }

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return DEFAULT_DATA();
      const parsed = JSON.parse(raw);
      const base = DEFAULT_DATA();
      return { records: { ...base.records, ...parsed.records }, stats: { ...base.stats, ...parsed.stats } };
    } catch {
      return DEFAULT_DATA();
    }
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      // Modo privado / cuota llena: el juego sigue sin persistencia.
    }
  }

  getRecord(gameId) {
    return this.data.records[gameId] || null;
  }

  /** Devuelve true si el puntaje supera el récord previo (y lo guarda). */
  submitScore(gameId, score, extra = {}) {
    const prev = this.getRecord(gameId);
    const isRecord = !prev || score > prev.score;
    if (isRecord) {
      this.data.records[gameId] = { score, date: new Date().toISOString(), ...extra };
    }
    this.save();
    return { isRecord, previous: prev };
  }

  addStats(delta) {
    const s = this.data.stats;
    s.rounds += delta.rounds || 0;
    s.devicesBroken += delta.devicesBroken || 0;
    s.playSeconds += delta.playSeconds || 0;
    if (delta.bestCombo && delta.bestCombo > s.bestCombo) s.bestCombo = delta.bestCombo;
    this.save();
  }

  get stats() {
    return this.data.stats;
  }
}
