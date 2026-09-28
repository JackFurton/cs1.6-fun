import type { MapData } from '../maps/types';

export interface MapImage {
  canvas: HTMLCanvasElement;
  /** World units per pixel. */
  scale: number;
  minX: number;
  minZ: number;
}

/** Top-down image of the map, brighter where the floor is higher. Used by the radar and ?mapview. */
export function renderMapImage(map: MapData, maxPx = 1024): MapImage {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const floors = map.brushes.filter((b) => !b.clip && !b.detail);
  for (const b of floors) {
    minX = Math.min(minX, b.min.x);
    minZ = Math.min(minZ, b.min.z);
    maxX = Math.max(maxX, b.max.x);
    maxZ = Math.max(maxZ, b.max.z);
  }
  for (const s of [...map.spawns.T, ...map.spawns.CT]) {
    minY = Math.min(minY, s.pos.y);
    maxY = Math.max(maxY, s.pos.y);
  }
  minY -= 96;
  // Anything topping out well above the highest spawn is a wall, not a floor.
  const wallY = maxY + 90;
  maxY += 160;
  const scale = Math.max(maxX - minX, maxZ - minZ) / maxPx;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil((maxX - minX) / scale);
  canvas.height = Math.ceil((maxZ - minZ) / scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Ceilings float above the floor; drawing them would hide tunnels.
  const sorted = floors.filter((b) => b.min.y <= wallY - 50).sort((a, b) => a.max.y - b.max.y);
  for (const b of sorted) {
    const wall = b.max.y > wallY;
    const t = Math.max(0, Math.min(1, (b.max.y - minY) / (maxY - minY)));
    const v = Math.round(70 + t * 130);
    ctx.fillStyle = wall ? '#1c1c1c' : `rgb(${v},${v},${Math.round(v * 0.92)})`;
    ctx.fillRect((b.min.x - minX) / scale, (b.min.z - minZ) / scale, (b.max.x - b.min.x) / scale, (b.max.z - b.min.z) / scale);
  }
  ctx.font = `bold ${Math.round(160 / scale)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const s of map.bombsites) {
    ctx.fillStyle = 'rgba(200,40,30,0.25)';
    ctx.fillRect((s.min.x - minX) / scale, (s.min.z - minZ) / scale, (s.max.x - s.min.x) / scale, (s.max.z - s.min.z) / scale);
    ctx.fillStyle = 'rgba(255,80,60,0.8)';
    ctx.fillText(s.name, ((s.min.x + s.max.x) / 2 - minX) / scale, ((s.min.z + s.max.z) / 2 - minZ) / scale);
  }
  return { canvas, scale, minX, minZ };
}

/** Debug page: the map image with spawns, buy zones and callouts drawn on top. */
export function showMapView(root: HTMLElement, map: MapData): MapImage {
  const img = renderMapImage(map, 1400);
  const ctx = img.canvas.getContext('2d')!;
  const px = (x: number) => (x - img.minX) / img.scale;
  const pz = (z: number) => (z - img.minZ) / img.scale;
  for (const team of ['T', 'CT'] as const) {
    ctx.strokeStyle = team === 'T' ? '#ff7a5a' : '#7ab4ff';
    for (const z of map.buyzones[team]) ctx.strokeRect(px(z.min.x), pz(z.min.z), (z.max.x - z.min.x) / img.scale, (z.max.z - z.min.z) / img.scale);
    ctx.fillStyle = ctx.strokeStyle;
    for (const s of map.spawns[team]) {
      ctx.beginPath();
      ctx.arc(px(s.pos.x), pz(s.pos.z), 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.fillStyle = '#ffe070';
  ctx.font = '12px sans-serif';
  for (const c of map.callouts) ctx.fillText(c.name, px((c.min.x + c.max.x) / 2), pz((c.min.z + c.max.z) / 2));
  // Grid every 512 units with labels, for authoring.
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = '10px monospace';
  for (let x = Math.ceil(img.minX / 512) * 512; px(x) < img.canvas.width; x += 512) {
    ctx.beginPath();
    ctx.moveTo(px(x), 0);
    ctx.lineTo(px(x), img.canvas.height);
    ctx.stroke();
    ctx.fillText(String(x), px(x) + 2, 10);
  }
  for (let z = Math.ceil(img.minZ / 512) * 512; pz(z) < img.canvas.height; z += 512) {
    ctx.beginPath();
    ctx.moveTo(0, pz(z));
    ctx.lineTo(img.canvas.width, pz(z));
    ctx.stroke();
    ctx.fillText(String(z), 2, pz(z) - 2);
  }
  img.canvas.style.cssText = 'max-width:100vw;max-height:100vh;display:block;margin:auto';
  root.appendChild(img.canvas);
  return img;
}
