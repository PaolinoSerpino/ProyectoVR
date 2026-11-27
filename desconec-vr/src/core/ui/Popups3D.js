import * as THREE from 'three';

/**
 * Popups 3D flotantes en el punto exacto del impacto ("+350 ¡CONTRA LA PARED!").
 * Pool fijo de sprites con textura canvas propia; suben, escalan con "pop" y se desvanecen.
 */
export class Popups3D {
  constructor(scene, size = 14) {
    this.items = [];
    for (let i = 0; i < size; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 160;
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false }));
      sprite.renderOrder = 999;
      sprite.visible = false;
      scene.add(sprite);
      this.items.push({ sprite, canvas, ctx: canvas.getContext('2d'), texture, life: 0, maxLife: 1, start: new THREE.Vector3() });
    }
    this.cursor = 0;
  }

  spawn(position, title, subtitle = '', color = '#FFD166', scale = 1) {
    const item = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.items.length;
    const { ctx, canvas } = item;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.font = '900 78px system-ui, sans-serif';
    ctx.lineWidth = 12;
    ctx.strokeStyle = 'rgba(20,20,20,0.85)';
    ctx.strokeText(title, 256, subtitle ? 82 : 105);
    ctx.fillStyle = color;
    ctx.fillText(title, 256, subtitle ? 82 : 105);
    if (subtitle) {
      ctx.font = '800 40px system-ui, sans-serif';
      ctx.lineWidth = 8;
      ctx.strokeText(subtitle, 256, 136);
      ctx.fillStyle = '#F4F0EA';
      ctx.fillText(subtitle, 256, 136);
    }
    item.texture.needsUpdate = true;
    item.start.copy(position);
    item.life = 0;
    item.maxLife = subtitle ? 1.6 : 1.1;
    item.baseScale = 0.55 * scale;
    item.sprite.visible = true;
    item.sprite.position.copy(position);
  }

  update(dt) {
    for (const item of this.items) {
      if (!item.sprite.visible) continue;
      item.life += dt;
      const t = item.life / item.maxLife;
      if (t >= 1) {
        item.sprite.visible = false;
        continue;
      }
      const pop = t < 0.12 ? THREE.MathUtils.lerp(0.4, 1.15, t / 0.12) : THREE.MathUtils.lerp(1.15, 1, Math.min(1, (t - 0.12) / 0.2));
      const s = item.baseScale * pop;
      item.sprite.scale.set(s, s * (160 / 512), 1);
      item.sprite.position.set(item.start.x, item.start.y + 0.15 + t * 0.55, item.start.z);
      item.sprite.material.opacity = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
    }
  }

  clear() {
    this.items.forEach((i) => { i.sprite.visible = false; });
  }
}
