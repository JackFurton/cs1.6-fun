import * as THREE from 'three';
import { CollisionWorld, Trace } from '../engine/trace';
import { Vec3, cross } from '../engine/vec';
import type { MapData } from '../maps/types';
import type { Face } from './mapmesh';

const AO_RAYS = 10;
const AO_LEN = 256;
const SUN_LEN = 8000;
/** Bump when the bake math changes so cached lightmaps are rebuilt. */
const BAKE_VERSION = 3;

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

export interface LightmapLayout {
  size: number;
  luxel: number;
  rects: Rect[];
  /** Lightmap UV for a vertex of a laid-out face. */
  uv(face: Face, v: Vec3): [number, number];
}

function axesFor(n: Vec3): ['x' | 'y' | 'z', 'x' | 'y' | 'z'] {
  const ax = Math.abs(n.x);
  const ay = Math.abs(n.y);
  const az = Math.abs(n.z);
  if (ay >= ax && ay >= az) return ['x', 'z'];
  if (ax >= az) return ['z', 'y'];
  return ['x', 'y'];
}

/** Assigns every face a block of the atlas. Cheap, so geometry can be built before the bake runs. */
export function layoutLightmap(faces: Face[], luxel: number): LightmapLayout {
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
    rects.push({ face, axes, minU, minV, w: Math.ceil((maxU - minU) / luxel) + 1, h: Math.ceil((maxV - minV) / luxel) + 1, x: 0, y: 0 });
  }

  // Shelf packing, tallest first, doubling the atlas until everything fits.
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

  const byFace = new Map<Face, Rect>(rects.map((r) => [r.face, r]));
  return {
    size,
    luxel,
    rects,
    uv(face, v) {
      const r = byFace.get(face)!;
      const x = r.x + 1 + (v[r.axes[0]] - r.minU) / luxel + 0.5;
      const y = r.y + 1 + (v[r.axes[1]] - r.minV) / luxel + 0.5;
      return [x / size, y / size];
    },
  };
}

/** Fixed cosine-weighted hemisphere directions around +Y (golden-angle spiral: even, no clumps). */
function hemisphere(n: number): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt((i + 0.5) / n);
    const a = i * 2.399963;
    out.push(new Vec3(Math.cos(a) * r, Math.sqrt(1 - r * r), Math.sin(a) * r));
  }
  return out;
}

export interface LightParams {
  sunDir: Vec3;
  sun: THREE.Color;
  sunIntensity: number;
  sky: THREE.Color;
  ground: THREE.Color;
  ambient: number;
}

export function lightParams(map: MapData): LightParams {
  return {
    sunDir: new Vec3(...map.sun.dir).scale(1),
    sun: new THREE.Color(map.sun.color),
    sunIntensity: map.sun.intensity,
    sky: new THREE.Color(0xdde6f0),
    ground: new THREE.Color(0x8a7458),
    ambient: map.ambient,
  };
}

/**
 * 1.6-style lightmap: for each texel, sky light scaled by how open it is (ambient occlusion)
 * plus direct sun if a ray toward the sun gets out. Stored as sqrt(light / 2) in RGB so an
 * 8-bit texture keeps detail in the shadows; the map shader squares it back.
 */
export function bakeLightmap(layout: LightmapLayout, world: CollisionWorld, lp: LightParams): Uint8Array {
  const { size, luxel } = layout;
  const data = new Uint8Array(size * size * 4).fill(255);
  const dirs = hemisphere(AO_RAYS);
  const toSun = lp.sunDir.clone().scale(-1);
  toSun.normalize();
  const tr = new Trace();
  const p = new Vec3();
  const end = new Vec3();
  const t = new Vec3();
  const b = new Vec3();
  const sky = new THREE.Color();
  // Tuned so a sunlit floor lands close to how the old realtime lighting looked.
  const skyScale = 0.42;
  const sunScale = 0.5;

  for (const r of layout.rects) {
    const n = r.face.normal;
    const up = Math.abs(n.y) < 0.9 ? new Vec3(0, 1, 0) : new Vec3(1, 0, 0);
    cross(up, n, t);
    t.normalize();
    cross(n, t, b);
    const [ua, va] = r.axes;
    const wa = (['x', 'y', 'z'] as const).find((a) => a !== ua && a !== va)!;
    const dist = n.dot(r.face.verts[0]);
    const uMax = r.minU + (r.w - 1) * luxel;
    const vMax = r.minV + (r.h - 1) * luxel;
    const nDotSun = Math.max(0, n.dot(toSun));
    // Hemisphere light: sky colour from above, ground bounce from below.
    sky.copy(lp.ground).lerp(lp.sky, n.y * 0.5 + 0.5);

    for (let j = 0; j < r.h; j++) {
      for (let i = 0; i < r.w; i++) {
        // Keep samples a little inside the face so edge texels don't sample the neighbour's solid.
        const u = Math.min(Math.max(r.minU + i * luxel, r.minU + 2), uMax - 2);
        const v = Math.min(Math.max(r.minV + j * luxel, r.minV + 2), vMax - 2);
        p.set(0, 0, 0);
        p[ua] = u;
        p[va] = v;
        p[wa] = (dist - n[ua] * u - n[va] * v) / (n[wa] || 1e-6);
        p.addScaled(n, 1.5);

        let occ = 0;
        for (const d of dirs) {
          end.copy(p).addScaled(t, d.x * AO_LEN).addScaled(n, d.y * AO_LEN).addScaled(b, d.z * AO_LEN);
          world.trace(p, end, undefined, undefined, tr);
          if (tr.fraction < 1) occ += 1 - tr.fraction * 0.6;
        }
        const ao = Math.max(0.12, Math.pow(1 - occ / AO_RAYS, 1.5));

        let sun = 0;
        if (nDotSun > 0) {
          end.copy(p).addScaled(toSun, SUN_LEN);
          if (world.trace(p, end, undefined, undefined, tr).fraction >= 1) sun = nDotSun;
        }

        const k = lp.ambient * skyScale * ao;
        const s = lp.sunIntensity * sunScale * sun;
        const idx = ((r.y + 1 + j) * size + (r.x + 1 + i)) * 4;
        const enc = (x: number) => Math.round(Math.sqrt(Math.min(1, x / 2)) * 255);
        data[idx] = enc(sky.r * k + lp.sun.r * s);
        data[idx + 1] = enc(sky.g * k + lp.sun.g * s);
        data[idx + 2] = enc(sky.b * k + lp.sun.b * s);
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
        data[dst] = data[src];
        data[dst + 1] = data[src + 1];
        data[dst + 2] = data[src + 2];
      }
    }
  }
  return data;
}

export function lightmapTexture(size: number, data: Uint8Array): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Key for caching a bake: changes whenever the geometry, lighting or bake code does. */
export function bakeKey(map: MapData, luxel: number): string {
  let h = 2166136261;
  const mix = (n: number) => {
    h = Math.imul(h ^ Math.round(n * 16), 16777619);
  };
  for (const b of map.brushes) {
    mix(b.min.x);
    mix(b.min.y);
    mix(b.min.z);
    mix(b.max.x);
    mix(b.max.y);
    mix(b.max.z);
    mix(b.planes.length);
  }
  for (const v of map.sun.dir) mix(v);
  mix(map.sun.intensity);
  mix(map.ambient);
  return `${map.name}:${luxel}:${BAKE_VERSION}:${(h >>> 0).toString(36)}`;
}

const DB = 'cs16fun-lightmaps';

/** Lightmaps cached in IndexedDB so a map only bakes once per browser. Fails soft to "no cache". */
export async function loadCachedBake(key: string): Promise<Uint8Array | null> {
  try {
    const db = await openDb();
    return await new Promise((res) => {
      const req = db.transaction('bakes').objectStore('bakes').get(key);
      req.onsuccess = () => res(req.result ?? null);
      req.onerror = () => res(null);
    });
  } catch {
    return null;
  }
}

export async function saveCachedBake(key: string, data: Uint8Array): Promise<void> {
  try {
    const db = await openDb();
    db.transaction('bakes', 'readwrite').objectStore('bakes').put(data, key);
  } catch {
    // Storage blocked or full: we'll just bake again next time.
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('bakes');
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
