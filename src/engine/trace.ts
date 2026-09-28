import type { Brush, Plane } from './brush';
import { Vec3 } from './vec';

// Same epsilon as Quake's CM_ClipBoxToBrush: keeps the box a hair off surfaces so the next trace doesn't start solid.
const DIST_EPSILON = 1 / 32;

export class Trace {
  fraction = 1;
  endpos = new Vec3();
  normal = new Vec3();
  startsolid = false;
  allsolid = false;
  brush: Brush | null = null;

  reset(): this {
    this.fraction = 1;
    this.normal.set(0, 0, 0);
    this.startsolid = false;
    this.allsolid = false;
    this.brush = null;
    return this;
  }
}

export const ZERO = new Vec3();

export function clipBoxToBrush(start: Vec3, end: Vec3, mins: Vec3, maxs: Vec3, brush: Brush, tr: Trace): void {
  let enterFrac = -1;
  let leaveFrac = 1;
  let clipPlane: Plane | null = null;
  let getout = false;
  let startout = false;

  for (const p of brush.planes) {
    const n = p.normal;
    // Push the plane out by the box corner that touches it first.
    const ox = n.x < 0 ? maxs.x : mins.x;
    const oy = n.y < 0 ? maxs.y : mins.y;
    const oz = n.z < 0 ? maxs.z : mins.z;
    const dist = p.dist - (ox * n.x + oy * n.y + oz * n.z);
    const d1 = start.x * n.x + start.y * n.y + start.z * n.z - dist;
    const d2 = end.x * n.x + end.y * n.y + end.z * n.z - dist;

    if (d2 > 0) getout = true;
    if (d1 > 0) startout = true;
    if (d1 > 0 && d2 >= d1) return;
    if (d1 <= 0 && d2 <= 0) continue;

    if (d1 > d2) {
      const f = (d1 - DIST_EPSILON) / (d1 - d2);
      if (f > enterFrac) {
        enterFrac = f;
        clipPlane = p;
      }
    } else {
      const f = (d1 + DIST_EPSILON) / (d1 - d2);
      if (f < leaveFrac) leaveFrac = f;
    }
  }

  if (!startout) {
    tr.startsolid = true;
    if (!getout) tr.allsolid = true;
    tr.fraction = 0;
    tr.brush = brush;
    return;
  }
  if (enterFrac < leaveFrac && enterFrac > -1 && enterFrac < tr.fraction) {
    tr.fraction = Math.max(0, enterFrac);
    tr.normal.copy(clipPlane!.normal);
    tr.brush = brush;
  }
}

export interface TraceFilter {
  (brush: Brush): boolean;
}

/** Uniform XZ grid over brush bounds so traces only test nearby brushes. */
export class BrushGrid {
  private cells = new Map<number, Brush[]>();
  private stamp = new Uint32Array(0);
  private frame = 0;
  constructor(
    readonly brushes: Brush[],
    private cellSize = 256,
  ) {
    let maxId = 0;
    for (const b of brushes) {
      maxId = Math.max(maxId, b.id);
      const [x0, z0, x1, z1] = this.range(b.min.x, b.min.z, b.max.x, b.max.z);
      for (let x = x0; x <= x1; x++)
        for (let z = z0; z <= z1; z++) {
          const k = this.key(x, z);
          let list = this.cells.get(k);
          if (!list) this.cells.set(k, (list = []));
          list.push(b);
        }
    }
    this.stamp = new Uint32Array(maxId + 1);
  }

  private key(x: number, z: number): number {
    return (x + 4096) * 8192 + (z + 4096);
  }

  private range(ax: number, az: number, bx: number, bz: number): [number, number, number, number] {
    const s = this.cellSize;
    return [Math.floor(ax / s), Math.floor(az / s), Math.floor(bx / s), Math.floor(bz / s)];
  }

  /** Calls fn for every brush whose cell overlaps the given XZ rectangle, each brush once. */
  query(ax: number, az: number, bx: number, bz: number, fn: (b: Brush) => void): void {
    this.frame++;
    if (this.frame === 0xffffffff) {
      this.stamp.fill(0);
      this.frame = 1;
    }
    const [x0, z0, x1, z1] = this.range(ax, az, bx, bz);
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        const list = this.cells.get(this.key(x, z));
        if (!list) continue;
        for (const b of list) {
          if (this.stamp[b.id] === this.frame) continue;
          this.stamp[b.id] = this.frame;
          fn(b);
        }
      }
  }
}

export class CollisionWorld {
  readonly grid: BrushGrid;
  readonly brushes: Brush[];
  /** Detail brushes are left out unless asked for (the light baker wants them to cast shadows). */
  constructor(brushes: Brush[], opts: { includeDetail?: boolean } = {}) {
    this.brushes = opts.includeDetail ? brushes : brushes.filter((b) => !b.detail);
    this.grid = new BrushGrid(this.brushes);
  }

  /** Sweep an AABB (mins/maxs relative to origin) from start to end against the world. */
  trace(start: Vec3, end: Vec3, mins: Vec3 = ZERO, maxs: Vec3 = ZERO, out = new Trace(), filter?: TraceFilter): Trace {
    out.reset();
    const ax = Math.min(start.x, end.x) + mins.x - 1;
    const bx = Math.max(start.x, end.x) + maxs.x + 1;
    const ay = Math.min(start.y, end.y) + mins.y - 1;
    const by = Math.max(start.y, end.y) + maxs.y + 1;
    const az = Math.min(start.z, end.z) + mins.z - 1;
    const bz = Math.max(start.z, end.z) + maxs.z + 1;
    this.grid.query(ax, az, bx, bz, (b) => {
      if (out.allsolid) return;
      if (b.min.x > bx || b.max.x < ax || b.min.y > by || b.max.y < ay || b.min.z > bz || b.max.z < az) return;
      if (filter && !filter(b)) return;
      clipBoxToBrush(start, end, mins, maxs, b, out);
    });
    out.endpos.lerpVectors(start, end, out.fraction);
    if (out.allsolid) out.endpos.copy(start);
    return out;
  }

  /** World trace plus extra solids (other players), each clipped as a box. */
  traceWith(start: Vec3, end: Vec3, mins: Vec3, maxs: Vec3, extra: readonly Brush[], out = new Trace()): Trace {
    this.trace(start, end, mins, maxs, out);
    if (out.allsolid || extra.length === 0) return out;
    for (const b of extra) clipBoxToBrush(start, end, mins, maxs, b, out);
    out.endpos.lerpVectors(start, end, out.fraction);
    if (out.allsolid) out.endpos.copy(start);
    return out;
  }

  /** Line of sight check that ignores see-through and clip brushes. */
  visible(a: Vec3, b: Vec3): boolean {
    return this.trace(a, b, ZERO, ZERO, scratch, sightFilter).fraction >= 1;
  }
}

const scratch = new Trace();
const sightFilter: TraceFilter = (b) => !b.seeThrough && !b.clip;
