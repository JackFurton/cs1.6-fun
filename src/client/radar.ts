import type { Vec3 } from '../engine/vec';
import type { Player } from '../game/player';
import type { MapData } from '../maps/types';
import { renderMapImage, type MapImage } from './minimap';

const SIZE = 190;
/** World units from the centre to the edge of the radar. */
const RANGE = 1600;

/** Rotating 1.6-style radar: you in the middle facing up, teammates as dots, the bomb for Terrorists. */
export class Radar {
  readonly canvas = document.createElement('canvas');
  private img: MapImage;
  private ctx: CanvasRenderingContext2D;

  constructor(parent: HTMLElement, map: MapData) {
    this.canvas.width = this.canvas.height = SIZE;
    this.canvas.className = 'radar';
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.img = renderMapImage(map, 1024);
  }

  draw(center: Vec3, yaw: number, local: Player, players: Player[], bomb: Vec3 | null): void {
    const c = this.ctx;
    const k = SIZE / 2 / RANGE;
    c.clearRect(0, 0, SIZE, SIZE);
    c.save();
    c.beginPath();
    c.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 1, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = 'rgba(0,0,0,0.5)';
    c.fillRect(0, 0, SIZE, SIZE);

    // World to radar: translate to the player, rotate so their facing is up, scale.
    c.translate(SIZE / 2, SIZE / 2);
    c.rotate((yaw * Math.PI) / 180);
    c.scale(k, k);
    c.translate(-center.x, -center.z);
    c.globalAlpha = 0.75;
    c.drawImage(this.img.canvas, this.img.minX, this.img.minZ, this.img.canvas.width * this.img.scale, this.img.canvas.height * this.img.scale);
    c.globalAlpha = 1;

    const dot = (p: Vec3, color: string, r: number) => {
      c.fillStyle = color;
      c.beginPath();
      c.arc(p.x, p.z, r / k, 0, Math.PI * 2);
      c.fill();
    };
    for (const p of players) {
      if (p === local || !p.alive || p.team !== local.team) continue;
      dot(p.origin, p.weapons.c4 ? '#ff4040' : local.team === 'T' ? '#ff9a50' : '#7ab4ff', 4);
    }
    if (bomb) dot(bomb, '#ff2020', 5);
    c.restore();

    // Local player arrow, always pointing up.
    c.fillStyle = '#fff';
    c.beginPath();
    c.moveTo(SIZE / 2, SIZE / 2 - 6);
    c.lineTo(SIZE / 2 - 4, SIZE / 2 + 4);
    c.lineTo(SIZE / 2 + 4, SIZE / 2 + 4);
    c.fill();
    c.strokeStyle = 'rgba(255,180,40,0.5)';
    c.beginPath();
    c.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 1, 0, Math.PI * 2);
    c.stroke();
  }
}
