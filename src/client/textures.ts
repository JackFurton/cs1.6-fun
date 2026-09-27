import * as THREE from 'three';

const SIZE = 128;

type Ctx = CanvasRenderingContext2D;

interface TexDef {
  /** World units covered by one repeat of the texture. */
  scale: number;
  draw(ctx: Ctx, rnd: () => number): void;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashName(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rgb(r: number, g: number, b: number): string {
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

function hexRgb(hex: number): [number, number, number] {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

/** Tileable value noise sampled on a wrapping grid. */
function tileNoise(rnd: () => number, cells: number): (x: number, y: number) => number {
  const g = Array.from({ length: cells * cells }, rnd);
  const at = (i: number, j: number) => g[((j % cells) + cells) % cells * cells + (((i % cells) + cells) % cells)];
  return (x, y) => {
    const fx = (x / SIZE) * cells;
    const fy = (y / SIZE) * cells;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const u = fx - i;
    const v = fy - j;
    const su = u * u * (3 - 2 * u);
    const sv = v * v * (3 - 2 * v);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * su;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * su;
    return a + (b - a) * sv;
  };
}

/** Fill every pixel from a base colour modulated by fractal noise and per-pixel grain. */
function noiseFill(ctx: Ctx, rnd: () => number, base: number, amount: number, grain: number, octaves = [4, 8, 16]): void {
  const img = ctx.getImageData(0, 0, SIZE, SIZE);
  const ns = octaves.map((c) => tileNoise(rnd, c));
  const [br, bg, bb] = hexRgb(base);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      let n = 0;
      let w = 0.5;
      for (const f of ns) {
        n += (f(x, y) - 0.5) * w;
        w *= 0.5;
      }
      const k = 1 + n * amount + (rnd() - 0.5) * grain;
      const i = (y * SIZE + x) * 4;
      img.data[i] = br * k;
      img.data[i + 1] = bg * k;
      img.data[i + 2] = bb * k;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
}

/** Multiply existing pixels by noise, keeping whatever was drawn underneath. */
function grime(ctx: Ctx, rnd: () => number, amount: number, grain: number): void {
  const img = ctx.getImageData(0, 0, SIZE, SIZE);
  const n1 = tileNoise(rnd, 4);
  const n2 = tileNoise(rnd, 16);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const k = 1 + ((n1(x, y) - 0.5) * 0.7 + (n2(x, y) - 0.5) * 0.3) * amount + (rnd() - 0.5) * grain;
      const i = (y * SIZE + x) * 4;
      img.data[i] *= k;
      img.data[i + 1] *= k;
      img.data[i + 2] *= k;
    }
  ctx.putImageData(img, 0, 0);
}

function rect(ctx: Ctx, x: number, y: number, w: number, h: number, c: string): void {
  ctx.fillStyle = c;
  ctx.fillRect(x, y, w, h);
}

function bricks(ctx: Ctx, rnd: () => number, base: number, mortar: string, rows: number, cols: number): void {
  rect(ctx, 0, 0, SIZE, SIZE, mortar);
  const [r, g, b] = hexRgb(base);
  const bh = SIZE / rows;
  const bw = SIZE / cols;
  for (let row = 0; row < rows; row++) {
    const off = row % 2 ? bw / 2 : 0;
    for (let col = -1; col < cols; col++) {
      const k = 0.85 + rnd() * 0.25;
      rect(ctx, col * bw + off + 1, row * bh + 1, bw - 2, bh - 2, rgb(r * k, g * k, b * k));
    }
  }
  grime(ctx, rnd, 0.35, 0.12);
}

function planks(ctx: Ctx, rnd: () => number, base: number, count: number, vertical: boolean): void {
  const [r, g, b] = hexRgb(base);
  const w = SIZE / count;
  for (let i = 0; i < count; i++) {
    const k = 0.8 + rnd() * 0.3;
    if (vertical) rect(ctx, i * w, 0, w, SIZE, rgb(r * k, g * k, b * k));
    else rect(ctx, 0, i * w, SIZE, w, rgb(r * k, g * k, b * k));
    // Grain streaks along the plank.
    for (let s = 0; s < 6; s++) {
      const p = i * w + rnd() * w;
      ctx.fillStyle = `rgba(40,25,10,${0.1 + rnd() * 0.15})`;
      if (vertical) ctx.fillRect(p, 0, 1, SIZE);
      else ctx.fillRect(0, p, SIZE, 1);
    }
    ctx.fillStyle = 'rgba(30,18,8,0.8)';
    if (vertical) ctx.fillRect(i * w, 0, 1, SIZE);
    else ctx.fillRect(0, i * w, SIZE, 1);
  }
  grime(ctx, rnd, 0.3, 0.08);
}

const DEFS: Record<string, TexDef> = {
  sand: { scale: 128, draw: (c, r) => noiseFill(c, r, 0xc4a870, 0.35, 0.12) },
  dirt: { scale: 128, draw: (c, r) => noiseFill(c, r, 0x8a7050, 0.45, 0.15) },
  grass: { scale: 128, draw: (c, r) => noiseFill(c, r, 0x5a7a3a, 0.5, 0.2) },
  asphalt: { scale: 128, draw: (c, r) => noiseFill(c, r, 0x55565a, 0.25, 0.2) },
  plaster: {
    scale: 128,
    draw: (c, r) => {
      noiseFill(c, r, 0xd2bc8c, 0.3, 0.06, [2, 4, 8]);
      // Chipped patches showing brick underneath.
      for (let i = 0; i < 3; i++) {
        const x = r() * SIZE;
        const y = r() * SIZE;
        c.fillStyle = 'rgba(150,100,60,0.35)';
        c.fillRect(x, y, 6 + r() * 14, 4 + r() * 8);
      }
    },
  },
  plaster_dark: { scale: 128, draw: (c, r) => noiseFill(c, r, 0xa89068, 0.3, 0.06, [2, 4, 8]) },
  brick: { scale: 128, draw: (c, r) => bricks(c, r, 0xb89468, 'rgb(120,100,80)', 8, 4) },
  brick_red: { scale: 128, draw: (c, r) => bricks(c, r, 0x8a4a38, 'rgb(90,80,70)', 8, 4) },
  stone: { scale: 128, draw: (c, r) => bricks(c, r, 0xa09a88, 'rgb(80,78,70)', 4, 2) },
  concrete: { scale: 128, draw: (c, r) => noiseFill(c, r, 0x9a9a94, 0.3, 0.1) },
  concrete_dark: { scale: 128, draw: (c, r) => noiseFill(c, r, 0x6c6c68, 0.3, 0.1) },
  concrete_floor: {
    scale: 128,
    draw: (c, r) => {
      noiseFill(c, r, 0x8c8c86, 0.25, 0.08);
      c.fillStyle = 'rgba(40,40,40,0.5)';
      c.fillRect(0, 0, SIZE, 1);
      c.fillRect(0, 0, 1, SIZE);
      c.fillRect(0, SIZE / 2, SIZE, 1);
      c.fillRect(SIZE / 2, 0, 1, SIZE);
    },
  },
  tile: {
    scale: 64,
    draw: (c, r) => {
      rect(c, 0, 0, SIZE, SIZE, 'rgb(90,90,88)');
      for (let y = 0; y < 4; y++)
        for (let x = 0; x < 4; x++) {
          const k = 200 + r() * 25;
          rect(c, x * 32 + 1, y * 32 + 1, 30, 30, rgb(k, k, k - 8));
        }
      grime(c, r, 0.25, 0.05);
    },
  },
  metal: {
    scale: 128,
    draw: (c, r) => {
      noiseFill(c, r, 0x7a8288, 0.2, 0.06);
      c.fillStyle = 'rgba(20,20,25,0.5)';
      c.fillRect(0, 0, SIZE, 2);
      c.fillRect(0, 0, 2, SIZE);
      c.fillStyle = 'rgba(30,30,35,0.8)';
      for (let i = 8; i < SIZE; i += 30) {
        c.fillRect(i, 6, 3, 3);
        c.fillRect(i, SIZE - 9, 3, 3);
      }
    },
  },
  metal_floor: {
    scale: 64,
    draw: (c, r) => {
      noiseFill(c, r, 0x80848a, 0.15, 0.05);
      c.fillStyle = 'rgba(210,215,220,0.35)';
      for (let y = 0; y < SIZE; y += 16)
        for (let x = (y / 16) % 2 ? 8 : 0; x < SIZE; x += 16) {
          c.save();
          c.translate(x + 4, y + 4);
          c.rotate(((y / 16) % 2 ? 1 : -1) * 0.7);
          c.fillRect(-4, -1, 8, 2);
          c.restore();
        }
    },
  },
  container_red: { scale: 128, draw: (c, r) => corrugated(c, r, 0x8e3a2e) },
  container_blue: { scale: 128, draw: (c, r) => corrugated(c, r, 0x3a5a86) },
  container_green: { scale: 128, draw: (c, r) => corrugated(c, r, 0x4f6e44) },
  container_yellow: { scale: 128, draw: (c, r) => corrugated(c, r, 0xb89030) },
  wood: { scale: 128, draw: (c, r) => planks(c, r, 0x8a6238, 6, false) },
  door: {
    scale: 128,
    draw: (c, r) => {
      planks(c, r, 0x6e4a2a, 8, true);
      c.strokeStyle = 'rgba(25,15,5,0.9)';
      c.lineWidth = 6;
      c.strokeRect(3, 3, SIZE - 6, SIZE - 6);
      c.fillStyle = 'rgba(20,20,20,0.9)';
      c.fillRect(20, 30, 88, 6);
      c.fillRect(20, 92, 88, 6);
    },
  },
  crate: {
    scale: 64,
    draw: (c, r) => {
      planks(c, r, 0xa0783c, 5, true);
      c.strokeStyle = 'rgb(92,62,28)';
      c.lineWidth = 16;
      c.strokeRect(8, 8, SIZE - 16, SIZE - 16);
      c.lineWidth = 12;
      c.beginPath();
      c.moveTo(12, 12);
      c.lineTo(SIZE - 12, SIZE - 12);
      c.stroke();
      c.strokeStyle = 'rgba(30,18,6,0.8)';
      c.lineWidth = 2;
      c.strokeRect(1, 1, SIZE - 2, SIZE - 2);
      c.strokeRect(16, 16, SIZE - 32, SIZE - 32);
      grime(c, r, 0.2, 0.05);
    },
  },
  crate_dark: {
    scale: 64,
    draw: (c, r) => {
      planks(c, r, 0x6a5238, 4, false);
      c.strokeStyle = 'rgb(50,40,30)';
      c.lineWidth = 12;
      c.strokeRect(6, 6, SIZE - 12, SIZE - 12);
      c.fillStyle = 'rgba(200,180,120,0.5)';
      c.font = 'bold 22px monospace';
      c.fillText('HANDLE', 24, 60);
      c.fillText('W/ CARE', 20, 86);
    },
  },
  trim: { scale: 64, draw: (c, r) => noiseFill(c, r, 0x5c5046, 0.2, 0.1) },
  hazard: {
    scale: 64,
    draw: (c) => {
      rect(c, 0, 0, SIZE, SIZE, 'rgb(210,170,30)');
      c.fillStyle = 'rgb(30,30,30)';
      for (let i = -SIZE; i < SIZE * 2; i += 32) {
        c.beginPath();
        c.moveTo(i, 0);
        c.lineTo(i + 16, 0);
        c.lineTo(i + 16 - SIZE, SIZE);
        c.lineTo(i - SIZE, SIZE);
        c.fill();
      }
    },
  },
  glass: {
    scale: 128,
    draw: (c) => {
      rect(c, 0, 0, SIZE, SIZE, 'rgb(160,190,200)');
      c.fillStyle = 'rgba(255,255,255,0.3)';
      c.fillRect(10, 10, 20, SIZE - 20);
    },
  },
  bombsite: {
    scale: 128,
    draw: (c, r) => {
      noiseFill(c, r, 0x8c8c86, 0.2, 0.06);
      c.fillStyle = 'rgba(180,30,20,0.75)';
      c.font = 'bold 90px sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('×', SIZE / 2, SIZE / 2);
    },
  },
};

function corrugated(c: Ctx, r: () => number, base: number): void {
  const [cr, cg, cb] = hexRgb(base);
  for (let x = 0; x < SIZE; x++) {
    const k = 0.8 + 0.25 * Math.sin((x / SIZE) * Math.PI * 2 * 8);
    rect(c, x, 0, 1, SIZE, rgb(cr * k, cg * k, cb * k));
  }
  grime(c, r, 0.4, 0.06);
  // Rust streaks running down from the top edge.
  for (let i = 0; i < 6; i++) {
    const x = r() * SIZE;
    const g = c.createLinearGradient(0, 0, 0, SIZE * (0.3 + r() * 0.6));
    g.addColorStop(0, 'rgba(90,45,20,0.5)');
    g.addColorStop(1, 'rgba(90,45,20,0)');
    c.fillStyle = g;
    c.fillRect(x, 0, 2 + r() * 4, SIZE);
  }
}

export function textureScale(name: string): number {
  return DEFS[name]?.scale ?? 128;
}

const cache = new Map<string, THREE.Texture>();

export function getTexture(name: string, anisotropy = 8): THREE.Texture {
  let tex = cache.get(name);
  if (tex) return tex;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const def = DEFS[name] ?? DEFS.concrete;
  def.draw(ctx, mulberry32(hashName(name)));
  tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  cache.set(name, tex);
  return tex;
}
