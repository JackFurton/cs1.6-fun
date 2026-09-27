import * as THREE from 'three';
import type { Smoke } from '../game/grenades';
import { SMOKE_RADIUS } from '../game/grenades';

function puff(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(200,200,196,1)');
  g.addColorStop(0.6, 'rgba(180,180,176,0.8)');
  g.addColorStop(1, 'rgba(160,160,156,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

const PUFFS = 36;

/** Billboard clouds for smoke grenades, grown over the first second and thinned at the end. */
export class SmokeRenderer {
  private tex = puff();
  private clouds = new Map<Smoke, THREE.Sprite[]>();

  constructor(private scene: THREE.Scene) {}

  update(smokes: readonly Smoke[], time: number): void {
    const live = new Set(smokes);
    for (const [s, sprites] of this.clouds) {
      if (live.has(s)) continue;
      for (const sp of sprites) {
        this.scene.remove(sp);
        sp.material.dispose();
      }
      this.clouds.delete(s);
    }
    for (const s of smokes) {
      let sprites = this.clouds.get(s);
      if (!sprites) {
        sprites = [];
        for (let i = 0; i < PUFFS; i++) {
          const m = new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false, opacity: 0, fog: true });
          const sp = new THREE.Sprite(m);
          // Scatter in a squashed sphere; store the offset for growth.
          const a = Math.random() * Math.PI * 2;
          const r = Math.sqrt(Math.random()) * SMOKE_RADIUS * 0.85;
          sp.userData.off = new THREE.Vector3(Math.cos(a) * r, (Math.random() - 0.3) * SMOKE_RADIUS * 0.8, Math.sin(a) * r);
          sp.userData.size = 110 + Math.random() * 70;
          sp.material.rotation = Math.random() * Math.PI * 2;
          this.scene.add(sp);
          sprites.push(sp);
        }
        this.clouds.set(s, sprites);
      }
      const age = time - s.start;
      const grow = Math.min(1, age / 1.2);
      const fade = Math.min(1, Math.max(0, (s.until - time) / 2.5));
      for (const sp of sprites) {
        const off = sp.userData.off as THREE.Vector3;
        sp.position.set(s.pos.x + off.x * grow, s.pos.y + off.y * grow, s.pos.z + off.z * grow);
        const size = sp.userData.size * (0.4 + 0.6 * grow);
        sp.scale.set(size, size, 1);
        sp.material.opacity = 0.92 * grow * fade;
      }
    }
  }
}
