/**
 * Puntaje dinámico por estilo. Nada es fijo por objeto: depende de CÓMO se rompió.
 *
 *  base      = valor del equipo + velocidad del impacto × 35 (tope 600)
 *  bonos     = Martillazo Crítico · Golpe en el Aire / Home Run · Contra la Pared / Piso · Reacción en Cadena
 *  combo     = roturas encadenadas con < 3 s de diferencia → multiplicador 1 + 0.5·(combo−1) (tope ×5)
 */
export const STYLE = {
  CRITICAL: { points: 250, label: '¡MARTILLAZO CRÍTICO!', color: '#FF6B35' },
  AIR: { points: 500, label: '¡GOLPE EN EL AIRE!', color: '#4CC9F0' },
  HOMERUN: { points: 800, label: '¡HOME RUN!', color: '#4CC9F0' },
  WALL: { points: 350, label: '¡CONTRA LA PARED!', color: '#FFD166' },
  FLOOR: { points: 250, label: '¡CONTRA EL PISO!', color: '#FFD166' },
  CHAIN: { points: 300, label: '¡REACCIÓN EN CADENA!', color: '#B5E48C' }
};

const COMBO_WINDOW = 3;
// Solo la arquitectura (no mesas ni estantes) otorga "Contra la Pared / el Piso"
const ARCHITECTURE = new Set(['brick', 'concrete', 'plaster']);
const CHAIN_WINDOW = 1.6;

export class ScoreSystem {
  constructor() {
    this.reset();
  }

  reset() {
    this.score = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.broken = 0;
    this.lastBreak = -Infinity;
    this.chains = new Map();
    this.nextChain = 1;
  }

  get multiplier() {
    return Math.min(5, 1 + Math.max(0, this.combo - 1) * 0.5);
  }

  comboTimeLeft(now) {
    return Math.max(0, COMBO_WINDOW - (now - this.lastBreak));
  }

  /** Vincula dos equipos a la misma cadena (uno golpeó al otro). Devuelve el id. */
  linkChain(source, target, now) {
    let id = source.chainId;
    const existing = id && this.chains.get(id);
    if (!existing || now - existing.time > CHAIN_WINDOW) {
      id = this.nextChain++;
      this.chains.set(id, { count: 0, time: now });
    }
    source.chainId = id;
    target.chainId = id;
    return id;
  }

  /**
   * @param {object} p
   * @param {import('./Device.js').Device} p.device
   * @param {'hammer'|'static'|'device'|'other'} p.by
   * @param {number} p.speed velocidad del impacto
   * @param {boolean} p.headHit golpe con la cabeza del martillo
   * @param {boolean} p.floor el impacto estático fue contra el piso
   * @param {string|null} p.surface superficie estática (solo muros/piso cuentan para "Contra la Pared")
   * @param {THREE.Vector3} p.point
   * @param {number} p.now segundos
   * @returns {{points:number, styles:object[], combo:number, multiplier:number}}
   */
  registerBreak({ device, by, speed, headHit, floor, surface, point, now }) {
    const styles = [];

    if (by === 'hammer') {
      if (device.airborne) styles.push(speed >= 9 ? STYLE.HOMERUN : STYLE.AIR);
      else if (headHit && speed >= 7) styles.push(STYLE.CRITICAL);
    } else if (by === 'static' && device.thrown && ARCHITECTURE.has(surface)) {
      const distance = device.thrown.position.distanceTo(point);
      const recent = performance.now() - device.thrown.time < 4000;
      if (recent && distance >= 1.5) styles.push(floor ? STYLE.FLOOR : STYLE.WALL);
    }

    if (device.chainId) {
      const chain = this.chains.get(device.chainId);
      if (chain && now - chain.time <= CHAIN_WINDOW) {
        chain.count += 1;
        chain.time = now;
        if (chain.count >= 2) styles.push({ ...STYLE.CHAIN, points: STYLE.CHAIN.points * (chain.count - 1), label: `¡REACCIÓN EN CADENA x${chain.count}!` });
      }
    }

    this.combo = now - this.lastBreak <= COMBO_WINDOW ? this.combo + 1 : 1;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.lastBreak = now;
    this.broken += 1;

    const base = device.spec.value + Math.min(600, speed * 35);
    const bonus = styles.reduce((s, st) => s + st.points, 0);
    const points = Math.round((base + bonus) * this.multiplier);
    this.score += points;
    return { points, styles, combo: this.combo, multiplier: this.multiplier };
  }
}
