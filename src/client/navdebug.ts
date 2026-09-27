import { BotManager } from '../bots/manager';
import { Game } from '../game/game';
import { BombDefusal } from '../game/rules';
import type { MapData } from '../maps/types';
import type { MapImage } from './minimap';

/** ?mapview=<map>&nav overlay: T routes, entrances, and bot hold spots with their look directions. */
export function drawNav(img: MapImage, map: MapData): void {
  const g = new Game(map);
  const mgr = new BotManager(g, new BombDefusal(g), 'normal');
  const c = img.canvas.getContext('2d')!;
  const px = (x: number) => (x - img.minX) / img.scale;
  const pz = (z: number) => (z - img.minZ) / img.scale;
  const colors = ['#ff0', '#f0f', '#0ff', '#f80'];
  for (const s of mgr.sites) {
    s.tRoutes.forEach((r, i) => {
      c.strokeStyle = colors[i % colors.length];
      c.globalAlpha = 0.5;
      c.beginPath();
      r.forEach((n, j) => (j ? c.lineTo(px(n.pos.x), pz(n.pos.z)) : c.moveTo(px(n.pos.x), pz(n.pos.z))));
      c.stroke();
    });
    c.globalAlpha = 1;
    for (const [spots, color] of [
      [s.ctHolds, '#4af'],
      [s.tHolds, '#f64'],
    ] as const) {
      for (const h of spots) {
        c.strokeStyle = color;
        c.globalAlpha = 0.35;
        c.beginPath();
        c.moveTo(px(h.pos.x), pz(h.pos.z));
        c.lineTo(px(h.look.x), pz(h.look.z));
        c.stroke();
        c.globalAlpha = 1;
        c.fillStyle = color;
        c.fillRect(px(h.pos.x) - 2, pz(h.pos.z) - 2, 4, 4);
      }
    }
    for (const e of s.tEntrances) {
      c.fillStyle = '#fff';
      c.beginPath();
      c.arc(px(e.x), pz(e.z), 6, 0, Math.PI * 2);
      c.fill();
    }
  }
}
