import * as THREE from 'three';
import { TextPanel, fitText } from '../../core/ui/TextPanel.js';
import { Materials } from '../../core/render/Materials.js';

/**
 * Marcador LED industrial (diegético) colgado en la pared:
 * tiempo restante, puntaje, combo, récord a vencer y una línea de estado.
 * Se redibuja solo cuando cambian los valores (máx. ~12 Hz).
 */
export class Scoreboard {
  constructor() {
    this.root = new THREE.Group();
    const w = 2.9, h = 1.25;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, h + 0.12, 0.1), Materials.paintedMetal(0x1a1c1d));
    frame.position.z = -0.05;
    frame.castShadow = true;
    this.root.add(frame);
    this.state = { time: 90, score: 0, combo: 0, multiplier: 1, record: 0, status: '', statusColor: '#FFD166', comboLeft: 0 };
    this.panel = new TextPanel({ width: w, height: h, pxPerMeter: 420, emissiveIntensity: 1.6, draw: (ctx, cw, ch) => this.draw(ctx, cw, ch) });
    this.panel.mesh.position.z = 0.002;
    this.root.add(this.panel.mesh);
    this.dirtyKey = '';
    this.blink = 0;
  }

  set(values) {
    Object.assign(this.state, values);
  }

  update(dt) {
    this.blink += dt;
    const s = this.state;
    const key = `${Math.ceil(s.time)}|${s.score}|${s.combo}|${s.record}|${s.status}|${Math.ceil(s.comboLeft * 4)}|${Math.floor(this.blink * 2) % 2}`;
    if (key !== this.dirtyKey) {
      this.dirtyKey = key;
      this.panel.redraw();
    }
  }

  draw(ctx, w, h) {
    const s = this.state;
    ctx.fillStyle = '#050607';
    ctx.fillRect(0, 0, w, h);

    const glowText = (text, x, y, size, color, align = 'left', maxW = w) => {
      ctx.textAlign = align;
      ctx.textBaseline = 'middle';
      ctx.shadowColor = color;
      ctx.shadowBlur = 18;
      ctx.fillStyle = color;
      fitText(ctx, text, x, y, maxW, size, '800', '"Courier New", monospace');
      ctx.shadowBlur = 0;
    };

    const seconds = Math.max(0, Math.ceil(s.time));
    const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
    const ss = String(seconds % 60).padStart(2, '0');
    const lowTime = seconds <= 10 && seconds > 0;
    const timeColor = lowTime && Math.floor(this.blink * 2) % 2 ? '#FF3B30' : '#FF9F1C';

    glowText('TIEMPO', w * 0.05, h * 0.12, 34, '#9a9a9a');
    glowText(`${mm}:${ss}`, w * 0.05, h * 0.32, 130, timeColor);
    glowText('PUNTAJE', w * 0.52, h * 0.12, 34, '#9a9a9a');
    glowText(s.score.toLocaleString('es-AR'), w * 0.52, h * 0.32, 120, '#38F07A', 'left', w * 0.46);

    glowText('COMBO', w * 0.05, h * 0.56, 30, '#9a9a9a');
    glowText(s.combo > 1 ? `x${s.multiplier.toFixed(1)}  (${s.combo})` : '—', w * 0.05, h * 0.7, 70, '#4CC9F0', 'left', w * 0.42);
    if (s.combo > 1) {
      ctx.fillStyle = '#4CC9F0';
      ctx.fillRect(w * 0.05, h * 0.79, w * 0.4 * (s.comboLeft / 3), 8);
    }
    glowText('RÉCORD A VENCER', w * 0.52, h * 0.56, 30, '#9a9a9a');
    glowText(s.record ? s.record.toLocaleString('es-AR') : '—', w * 0.52, h * 0.7, 70, '#E9C46A', 'left', w * 0.46);

    ctx.fillStyle = '#111416';
    ctx.fillRect(0, h * 0.85, w, h * 0.15);
    glowText(s.status, w / 2, h * 0.925, 46, s.statusColor, 'center', w * 0.94);

    // Retícula de "LEDs" para el look de matriz de puntos
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    const step = 6;
    for (let y = 0; y < h; y += step) ctx.fillRect(0, y, w, 2);
    for (let x = 0; x < w; x += step) ctx.fillRect(x, 0, 2, h);
  }
}
