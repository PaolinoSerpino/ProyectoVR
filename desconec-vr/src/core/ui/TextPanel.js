import * as THREE from 'three';

/**
 * Panel diegético dibujado con Canvas 2D sobre un plano (carteles, tableros LED, récords).
 * `draw(ctx, w, h)` se invoca en cada `redraw()`.
 */
export class TextPanel {
  constructor({ width, height, pxPerMeter = 512, draw, emissive = true, transparent = false, emissiveIntensity = 1 }) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(width * pxPerMeter);
    this.canvas.height = Math.round(height * pxPerMeter);
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.drawFn = draw;
    const material = emissive
      ? new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: this.texture, emissiveIntensity, roughness: 0.6, transparent })
      : new THREE.MeshStandardMaterial({ map: this.texture, roughness: 0.75, transparent });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    this.redraw();
  }

  redraw(...args) {
    const { canvas, ctx } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.drawFn(ctx, canvas.width, canvas.height, ...args);
    this.texture.needsUpdate = true;
  }
}

/** Texto centrado con ajuste automático de tamaño a un ancho máximo. */
export function fitText(ctx, text, x, y, maxWidth, size, weight = '700', family = 'system-ui, sans-serif') {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  while (ctx.measureText(text).width > maxWidth && s > 8) {
    s -= 2;
    ctx.font = `${weight} ${s}px ${family}`;
  }
  ctx.fillText(text, x, y);
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
