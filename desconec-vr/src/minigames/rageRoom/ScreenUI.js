import * as THREE from 'three';

/**
 * Interfaces de pantalla procedurales (escritorio y móvil) con notificaciones, insignias
 * rojas y "scroll infinito", más el dibujado de grietas desde el punto de impacto.
 * Las texturas base se comparten por variante; cada equipo obtiene su propio canvas
 * recién cuando recibe daño (copy-on-write).
 */
const baseCache = new Map();
const APPS = ['#E63946', '#F4A261', '#2A9D8F', '#457B9D', '#8E7DBE', '#F15BB5', '#06D6A0', '#FFD166'];
const NOTIFS = [
  ['Grupo Familia', '+99 mensajes sin leer'], ['URGENTE', 'Responder antes de las 18:00'], ['Trabajo', 'Reunión movida (otra vez)'],
  ['Tendencias', 'Esto está explotando ahora'], ['Banco', 'Movimiento detectado'], ['Red social', 'A 37 personas les gustó'],
  ['Recordatorio', 'Tenés 14 tareas pendientes'], ['Noticias', 'ÚLTIMO MOMENTO'], ['Correo', '248 correos nuevos']
];

function seeded(seed) {
  let s = seed * 9301 + 49297;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function drawDesktop(ctx, w, h, seed) {
  const rnd = seeded(seed);
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, ['#1d3557', '#3a0ca3', '#264653', '#22223b'][seed % 4]);
  g.addColorStop(1, ['#e63946', '#4cc9f0', '#e9c46a', '#9a8c98'][seed % 4]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // Ventanas apiladas con "scroll infinito"
  for (let i = 0; i < 3; i++) {
    const x = w * (0.05 + rnd() * 0.25), y = h * (0.08 + i * 0.12 + rnd() * 0.05);
    const ww = w * (0.45 + rnd() * 0.2), wh = h * 0.55;
    ctx.fillStyle = 'rgba(245,245,250,0.96)';
    ctx.fillRect(x, y, ww, wh);
    ctx.fillStyle = '#d0d4dc';
    ctx.fillRect(x, y, ww, h * 0.05);
    for (let r = 0; r < 6; r++) {
      ctx.fillStyle = APPS[(seed + r + i) % APPS.length];
      ctx.beginPath();
      ctx.arc(x + ww * 0.08, y + h * (0.11 + r * 0.075), h * 0.022, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#9aa0ab';
      ctx.fillRect(x + ww * 0.15, y + h * (0.1 + r * 0.075), ww * (0.4 + rnd() * 0.4), h * 0.018);
    }
  }
  // Toasts de notificación con insignia roja
  ctx.font = `700 ${Math.round(h * 0.045)}px system-ui, sans-serif`;
  for (let i = 0; i < 3; i++) {
    const [title, body] = NOTIFS[(seed * 3 + i) % NOTIFS.length];
    const x = w * 0.62, y = h * (0.1 + i * 0.2), tw = w * 0.35, th = h * 0.16;
    ctx.fillStyle = 'rgba(25,25,30,0.92)';
    ctx.fillRect(x, y, tw, th);
    ctx.fillStyle = '#ff3b30';
    ctx.beginPath();
    ctx.arc(x + tw - h * 0.03, y + h * 0.03, h * 0.028, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(title, x + w * 0.015, y + th * 0.42);
    ctx.fillStyle = '#c7c7cc';
    ctx.font = `500 ${Math.round(h * 0.035)}px system-ui, sans-serif`;
    ctx.fillText(body, x + w * 0.015, y + th * 0.78);
    ctx.font = `700 ${Math.round(h * 0.045)}px system-ui, sans-serif`;
  }
  // Barra de tareas
  ctx.fillStyle = 'rgba(15,15,20,0.9)';
  ctx.fillRect(0, h * 0.92, w, h * 0.08);
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = APPS[i];
    ctx.fillRect(w * (0.3 + i * 0.05), h * 0.935, h * 0.05, h * 0.05);
  }
}

function drawMobile(ctx, w, h, seed) {
  const rnd = seeded(seed + 17);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, ['#0b132b', '#3c096c', '#1b4332', '#22223b'][seed % 4]);
  g.addColorStop(1, ['#5bc0be', '#ff6d00', '#95d5b2', '#c9ada7'][seed % 4]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 ${Math.round(w * 0.16)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(`${10 + Math.floor(rnd() * 12)}:${String(Math.floor(rnd() * 60)).padStart(2, '0')}`, w / 2, h * 0.17);
  ctx.textAlign = 'left';
  for (let i = 0; i < 5; i++) {
    const [title, body] = NOTIFS[(seed * 2 + i) % NOTIFS.length];
    const y = h * (0.25 + i * 0.14);
    ctx.fillStyle = 'rgba(250,250,252,0.88)';
    ctx.fillRect(w * 0.05, y, w * 0.9, h * 0.12);
    ctx.fillStyle = APPS[(seed + i) % APPS.length];
    ctx.fillRect(w * 0.09, y + h * 0.025, w * 0.13, w * 0.13);
    ctx.fillStyle = '#111';
    ctx.font = `700 ${Math.round(w * 0.065)}px system-ui, sans-serif`;
    ctx.fillText(title, w * 0.27, y + h * 0.05);
    ctx.fillStyle = '#555';
    ctx.font = `500 ${Math.round(w * 0.05)}px system-ui, sans-serif`;
    ctx.fillText(body, w * 0.27, y + h * 0.095);
    ctx.fillStyle = '#ff3b30';
    ctx.beginPath();
    ctx.arc(w * 0.9, y + h * 0.015, w * 0.045, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Textura base compartida por variante. */
export function getScreenTexture(kind, seed) {
  const key = `${kind}-${seed % 4}`;
  if (baseCache.has(key)) return baseCache.get(key);
  const canvas = document.createElement('canvas');
  if (kind === 'desktop') {
    canvas.width = 512; canvas.height = 300;
    drawDesktop(canvas.getContext('2d'), 512, 300, seed % 4);
  } else {
    canvas.width = 192; canvas.height = 384;
    drawMobile(canvas.getContext('2d'), 192, 384, seed % 4);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  baseCache.set(key, tex);
  return tex;
}

/**
 * Controlador de una pantalla concreta: grietas acumulativas y parpadeo según el daño.
 */
export class ScreenController {
  constructor(material, baseTexture) {
    this.material = material;
    this.baseTexture = baseTexture;
    this.canvas = null;
    this.ctx = null;
    this.damage = 0;
    this.flicker = 0;
  }

  ensureOwnCanvas() {
    if (this.canvas) return;
    const src = this.baseTexture.image;
    this.canvas = document.createElement('canvas');
    this.canvas.width = src.width;
    this.canvas.height = src.height;
    this.ctx = this.canvas.getContext('2d');
    this.ctx.drawImage(src, 0, 0);
    const tex = new THREE.CanvasTexture(this.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.material.emissiveMap = tex;
    this.material.needsUpdate = true;
  }

  /** Grieta radial desde (u,v) ∈ [0,1]²; `severity` 0..1 controla largo y cantidad de ramas. */
  crack(u, v, severity) {
    this.ensureOwnCanvas();
    const { ctx, canvas } = this;
    const w = canvas.width, h = canvas.height;
    const cx = u * w, cy = (1 - v) * h;
    const branches = 5 + Math.round(severity * 9);
    ctx.lineCap = 'round';

    // Mancha de LCD dañado (pixeles muertos)
    const blot = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * (0.06 + severity * 0.12));
    blot.addColorStop(0, 'rgba(0,0,0,0.95)');
    blot.addColorStop(0.5, 'rgba(40,0,60,0.55)');
    blot.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = blot;
    ctx.fillRect(0, 0, w, h);

    for (let b = 0; b < branches; b++) {
      let x = cx, y = cy;
      let a = (b / branches) * Math.PI * 2 + Math.random() * 0.5;
      const len = Math.max(w, h) * (0.15 + severity * 0.55) * (0.5 + Math.random() * 0.5);
      const steps = 8;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let s = 0; s < steps; s++) {
        a += (Math.random() - 0.5) * 0.6;
        x += Math.cos(a) * (len / steps);
        y += Math.sin(a) * (len / steps);
        ctx.lineTo(x, y);
      }
      ctx.strokeStyle = 'rgba(235,240,255,0.85)';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
    // Anillo concéntrico de vidrio astillado
    ctx.strokeStyle = 'rgba(230,235,255,0.6)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(w, h) * (0.02 + severity * 0.04), 0, Math.PI * 2);
    ctx.stroke();

    this.material.emissiveMap.needsUpdate = true;
    this.damage = Math.min(1, this.damage + severity);
    this.flicker = 0.6;
  }

  update(dt) {
    if (this.damage <= 0) return;
    this.flicker = Math.max(0, this.flicker - dt);
    const base = 1.15 * (1 - this.damage * 0.45);
    const jitter = this.flicker > 0 || Math.random() < this.damage * 0.04 ? Math.random() * 0.9 : 1;
    this.material.emissiveIntensity = base * jitter;
  }
}
