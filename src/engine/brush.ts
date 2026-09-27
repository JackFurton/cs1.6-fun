import { Vec3 } from './vec';

export interface Plane {
  normal: Vec3;
  dist: number;
}

export type RampDir = '+x' | '-x' | '+z' | '-z';

export interface Brush {
  planes: Plane[];
  min: Vec3;
  max: Vec3;
  tex: string;
  /** Clips movement only; not rendered and bullets pass through. */
  clip?: boolean;
  /** Blocks movement but not line of sight (fences, glass). */
  seeThrough?: boolean;
  /** Units of material a bullet loses crossing 1 unit of this brush (wallbang cost multiplier). */
  penetration?: number;
  id: number;
}

let nextId = 0;

function plane(nx: number, ny: number, nz: number, dist: number): Plane {
  return { normal: new Vec3(nx, ny, nz), dist };
}

function boxPlanes(min: Vec3, max: Vec3): Plane[] {
  return [
    plane(1, 0, 0, max.x),
    plane(-1, 0, 0, -min.x),
    plane(0, 1, 0, max.y),
    plane(0, -1, 0, -min.y),
    plane(0, 0, 1, max.z),
    plane(0, 0, -1, -min.z),
  ];
}

export interface BrushOpts {
  clip?: boolean;
  seeThrough?: boolean;
  penetration?: number;
}

export function boxBrush(min: Vec3, max: Vec3, tex: string, opts: BrushOpts = {}): Brush {
  return { planes: boxPlanes(min, max), min: min.clone(), max: max.clone(), tex, id: nextId++, ...opts };
}

/**
 * Wedge filling the box, rising from min.y on the low side to max.y on the side named by `dir`.
 * The axial box planes stay in the list as bevels so box traces don't catch on the sloped edge.
 */
export function rampBrush(min: Vec3, max: Vec3, dir: RampDir, tex: string, opts: BrushOpts = {}): Brush {
  const planes = boxPlanes(min, max);
  const h = max.y - min.y;
  const axis = dir[1] as 'x' | 'z';
  const len = max[axis] - min[axis];
  const sign = dir[0] === '+' ? 1 : -1;
  const n = new Vec3();
  n.y = len;
  n[axis] = -sign * h;
  n.normalize();
  // Low edge of the slope sits on the floor at the "from" side.
  const low = new Vec3(min.x, min.y, min.z);
  if (sign < 0) low[axis] = max[axis];
  planes.push({ normal: n, dist: n.dot(low) });
  return { planes, min: min.clone(), max: max.clone(), tex, id: nextId++, ...opts };
}

/** Re-point an existing box brush at new bounds without allocating. */
export function setBoxBrush(b: Brush, min: Vec3, max: Vec3): void {
  b.min.copy(min);
  b.max.copy(max);
  const p = b.planes;
  p[0].dist = max.x;
  p[1].dist = -min.x;
  p[2].dist = max.y;
  p[3].dist = -min.y;
  p[4].dist = max.z;
  p[5].dist = -min.z;
}
