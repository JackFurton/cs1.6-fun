import * as THREE from 'three';
import { CollisionWorld, Trace } from '../engine/trace';
import { Vec3, cross } from '../engine/vec';
import type { Face } from './mapmesh';

/** World units per lightmap texel. */
const LUXEL = 24;
const RAYS = 16;
const RAY_LEN = 256;

interface Rect {
  face: Face;
  /** Which two world axes the face is projected onto. */
  axes: ['x' | 'y' | 'z', 'x' | 'y' | 'z'];
  minU: number;
  minV: number;
  /** Luxels across, not counting the one-texel border on each side. */
  w: number;
  h: number;
  x: number;
  y: number;
}

export interface AOBake {
  texture: THREE.DataTexture;
  /** Lightmap UV for a vertex of a face that was baked. */
  uv(face: Face, v: Vec3): [number, number];
  ms: number;
  luxels: number;
}

function axesFor(n: Vec3): ['x' | 'y' | 'z', 'x' | 'y' | 'z'] {
  const ax = Math.abs(n.x);
  const ay = Math.abs(n.y);
  const az = Math.abs(n.z);
  if (ay >= ax && ay >= az) return ['x', 'z'];
  if (ax >= az) return ['z', 'y'];
  return ['x', 'y'];
}

/** Fixed cosine-weighted hemisphere directions around +Y, rotated per face. */
function hemisphere(n: number): Vec3[] {
  const out: Vec3[] = [];
  // Golden-angle spiral gives an even spread without random clumping.
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt((i + 0.5) / n);
    const a = i * 2.399963;
    out.push(new Vec3(Math.cos(a) * r, Math.sqrt(1 - r * r), Math.sin(a) * r));
  }
  return out;
}

/**
 * Bakes ambient occlusion for every face into one atlas, the way 1.6's radiosity pass
 * darkened corners and the undersides of ledges. Used as the map's aoMap, so it only
 * darkens the sky/fill light, not direct sun.
 */
export function bakeAO(faces: Face[], world: CollisionWorld): AOBake {
  const t0 = performance.now();
  const rects: Rect[] = [];
  for (const face of faces) {
    const axes = axesFor(face.normal);
    let minU = Infinity;
    let minV = Infinity;
    let maxU = -Infinity;
    let maxV = -Infinity;
    for (const v of face.verts) {
      minU = Math.min(minU, v[axes[0]]);
      maxU = Math.max(maxU, v[axes[0]]);
      minV = Math.min(minV, v[axes[1]]);
      maxV = Math.max(maxV, v[axes[1]]);
    }
    rects.push({ face, axes, minU, minV, w: Math.ceil((maxU - minU) / LUXEL) + 1, h: Math.ceil((maxV - minV) / LUXEL) + 1, x: 0, y: 0 });
  }

  // Shelf packing, tallest first.
  const order = [...rects].sort((a, b) => b.h - a.h);
  let size = 512;
  for (;;) {
    let x = 0;
    let y = 0;
    let shelf = 0;
    let fits = true;
    for (const r of order) {
      const w = r.w + 2;
      const h = r.h + 2;
      if (w > size) {
        fits = false;
        break;
      }
      if (x + w > size) {
        x = 0;
        y += shelf;
        shelf = 0;
      }
      r.x = x;
      r.y = y;
      x += w;
      shelf = Math.max(shelf, h);
      if (y + shelf > size) {
        fits = false;
        break;
      }
    }
    if (fits || size >= 4096) break;
    size *= 2;
  }

  const data = new Uint8Array(size * size * 4).fill(255);
  const dirs = hemisphere(RAYS);
  const tr = new Trace();
  const p = new Vec3();
  const end = new Vec3();
  const t = new Vec3();
  const b = new Vec3();
  let luxels = 0;

  for (const r of rects) {
    const n = r.face.normal;
    // Tangent frame for rotating the hemisphere onto the face normal.
    const up = Math.abs(n.y) < 0.9 ? new Vec3(0, 1, 0) : new Vec3(1, 0, 0);
    cross(up, n, t);
    t.normalize();
    cross(n, t, b);
    const [ua, va] = r.axes;
    // The third axis gets solved from the plane equation.
    const wa = (['x', 'y', 'z'] as const).find((a) => a !== ua && a !== va)!;
    const dist = n.dot(r.face.verts[0]);
    // Keep samples a little inside the face so edge texels don't sample the neighbour's solid.
    const uMax = r.minU + (r.w - 1) * LUXEL;
    const vMax = r.minV + (r.h - 1) * LUXEL;
    for (let j = 0; j < r.h; j++) {
      for (let i = 0; i < r.w; i++) {
        const u = Math.min(Math.max(r.minU + i * LUXEL, r.minU + 2), uMax - 2);
        const v = Math.min(Math.max(r.minV + j * LUXEL, r.minV + 2), vMax - 2);
        p.set(0, 0, 0);
        p[ua] = u;
        p[va] = v;
        p[wa] = (dist - n[ua] * u - n[va] * v) / (n[wa] || 1e-6);
        p.addScaled(n, 1.5);
        let occ = 0;
        for (const d of dirs) {
          end.copy(p).addScaled(t, d.x * RAY_LEN).addScaled(n, d.y * RAY_LEN).addScaled(b, d.z * RAY_LEN);
          world.trace(p, end, undefined, undefined, tr);
          // Close hits darken more than distant ones.
          if (tr.fraction < 1) occ += 1 - tr.fraction * 0.6;
        }
        const ao = Math.max(0.15, Math.pow(1 - occ / RAYS, 1.7));
        const v8 = Math.round(ao * 255);
        const idx = ((r.y + 1 + j) * size + (r.x + 1 + i)) * 4;
        data[idx] = data[idx + 1] = data[idx + 2] = v8;
        luxels++;
      }
    }
    // Copy edges into the one-texel border so filtering never pulls in another face.
    const W = r.w + 2;
    const H = r.h + 2;
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        if (i > 0 && j > 0 && i < W - 1 && j < H - 1) continue;
        const si = Math.min(Math.max(i, 1), W - 2);
        const sj = Math.min(Math.max(j, 1), H - 2);
        const src = ((r.y + sj) * size + (r.x + si)) * 4;
        const dst = ((r.y + j) * size + (r.x + i)) * 4;
        data[dst] = data[dst + 1] = data[dst + 2] = data[src];
      }
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.channel = 1;
  texture.needsUpdate = true;

  const byFace = new Map<Face, Rect>(rects.map((r) => [r.face, r]));
  return {
    texture,
    luxels,
    ms: performance.now() - t0,
    uv(face, v) {
      const r = byFace.get(face)!;
      const x = r.x + 1 + (v[r.axes[0]] - r.minU) / LUXEL + 0.5;
      const y = r.y + 1 + (v[r.axes[1]] - r.minV) / LUXEL + 0.5;
      return [x / size, y / size];
    },
  };
}
