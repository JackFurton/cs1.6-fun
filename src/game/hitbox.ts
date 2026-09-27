import type { Vec3 } from '../engine/vec';
import { DEG } from '../engine/vec';

export type HitGroup = 'head' | 'chest' | 'stomach' | 'legs';

export const HITGROUP_MULT: Record<HitGroup, number> = { head: 4, chest: 1, stomach: 1.25, legs: 0.75 };

/** Vertical extents [bottom, top] of each body part, standing and fully ducked. Shared by the model and hitboxes. */
export const BODY_STAND = { legs: [0, 34], stomach: [34, 44], chest: [44, 58], head: [58, 71] } as const;
export const BODY_DUCK = { legs: [0, 10], stomach: [10, 17], chest: [17, 26], head: [26, 37] } as const;

/** Half widths [right, forward] of each part. */
export const BODY_HALF: Record<HitGroup, [number, number]> = { head: [5.5, 6], chest: [11, 7], stomach: [9.5, 6.5], legs: [9, 6] };

const GROUPS: HitGroup[] = ['head', 'chest', 'stomach', 'legs'];

export function bodyRange(part: HitGroup, duck: number): [number, number] {
  const a = BODY_STAND[part];
  const b = BODY_DUCK[part];
  return [a[0] + (b[0] - a[0]) * duck, a[1] + (b[1] - a[1]) * duck];
}

export interface BodyHit {
  dist: number;
  group: HitGroup;
}

/**
 * Ray against the oriented hitboxes of a player standing at `origin` facing `yaw`.
 * Returns the nearest hit within maxDist.
 */
export function rayHitBody(start: Vec3, dir: Vec3, maxDist: number, origin: Vec3, yaw: number, duck: number): BodyHit | null {
  const s = Math.sin(yaw * DEG);
  const c = Math.cos(yaw * DEG);
  // Local frame: x = right (c, 0, -s), z = forward (-s, 0, -c).
  const px = start.x - origin.x;
  const py = start.y - origin.y;
  const pz = start.z - origin.z;
  const ox = px * c - pz * s;
  const oz = -px * s - pz * c;
  const dx = dir.x * c - dir.z * s;
  const dz = -dir.x * s - dir.z * c;

  // Cheap reject against the whole body first.
  if (slab(ox, py, oz, dx, dir.y, dz, -12, 0, -12, 12, 72, 12, maxDist) === null) return null;

  let best: BodyHit | null = null;
  for (const g of GROUPS) {
    const [y0, y1] = bodyRange(g, duck);
    const [hr, hf] = BODY_HALF[g];
    const f = g === 'head' ? 1 : 0;
    const t = slab(ox, py, oz, dx, dir.y, dz, -hr, y0, -hf + f, hr, y1, hf + f, maxDist);
    if (t !== null && (!best || t < best.dist)) best = { dist: t, group: g };
  }
  return best;
}

function slab(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, maxDist: number): number | null {
  let tmin = 0;
  let tmax = maxDist;
  for (const [o, d, lo, hi] of [
    [ox, dx, x0, x1],
    [oy, dy, y0, y1],
    [oz, dz, z0, z1],
  ]) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let t0 = (lo - o) / d;
    let t1 = (hi - o) / d;
    if (t0 > t1) [t0, t1] = [t1, t0];
    tmin = Math.max(tmin, t0);
    tmax = Math.min(tmax, t1);
    if (tmin > tmax) return null;
  }
  return tmin;
}
