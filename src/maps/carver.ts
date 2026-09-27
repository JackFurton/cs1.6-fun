import type { MapBuilder } from './builder';

export interface RoomOpts {
  floor?: string;
  /** Solid ceiling at this height above world zero (tunnels, indoor rooms). */
  ceiling?: number;
  ceilingTex?: string;
}

interface Room {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  y: number;
  opts: RoomOpts;
}

interface WallZone {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  tex: string;
  height?: number;
}

/**
 * Authoring helper: declare the walkable rooms, and everything else inside the bounds
 * becomes solid wall. Rooms may overlap; where they do, the later room's floor wins.
 * All coordinates should sit on the grid (default 16 units).
 */
export class Carver {
  private rooms: Room[] = [];
  private wallZones: WallZone[] = [];

  constructor(
    readonly x0: number,
    readonly z0: number,
    readonly x1: number,
    readonly z1: number,
    readonly grid = 16,
  ) {}

  room(x0: number, z0: number, x1: number, z1: number, y: number, opts: RoomOpts = {}): this {
    this.rooms.push({ x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), y, opts });
    return this;
  }

  /** Walls whose centre falls in this rectangle get this texture (and height). First match wins. */
  wallTex(x0: number, z0: number, x1: number, z1: number, tex: string, height?: number): this {
    this.wallZones.push({ x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), tex, height });
    return this;
  }

  build(m: MapBuilder, wallHeight: number, defaultWall: string, defaultFloor: string, base = -64): void {
    for (const r of this.rooms) {
      m.box(r.x0, base, r.z0, r.x1, r.y, r.z1, r.opts.floor ?? defaultFloor);
      if (r.opts.ceiling !== undefined) m.box(r.x0, r.opts.ceiling, r.z0, r.x1, wallHeight, r.z1, r.opts.ceilingTex ?? 'concrete_dark');
    }

    const g = this.grid;
    const nx = Math.round((this.x1 - this.x0) / g);
    const nz = Math.round((this.z1 - this.z0) / g);
    const open = new Uint8Array(nx * nz);
    for (const r of this.rooms) {
      const i0 = Math.max(0, Math.round((r.x0 - this.x0) / g));
      const i1 = Math.min(nx, Math.round((r.x1 - this.x0) / g));
      const k0 = Math.max(0, Math.round((r.z0 - this.z0) / g));
      const k1 = Math.min(nz, Math.round((r.z1 - this.z0) / g));
      for (let k = k0; k < k1; k++) for (let i = i0; i < i1; i++) open[k * nx + i] = 1;
    }

    // Each solid cell remembers its wall zone so merged boxes never straddle two textures/heights.
    const zoneOf = new Int16Array(nx * nz);
    for (let k = 0; k < nz; k++)
      for (let i = 0; i < nx; i++) {
        const cx = this.x0 + (i + 0.5) * g;
        const cz = this.z0 + (k + 0.5) * g;
        zoneOf[k * nx + i] = this.wallZones.findIndex((z) => cx >= z.x0 && cx <= z.x1 && cz >= z.z0 && cz <= z.z1);
      }

    // Greedy merge solid cells into rectangles: extend right, then down while the whole row fits.
    const used = new Uint8Array(nx * nz);
    const free = (j: number, zone: number) => !open[j] && !used[j] && zoneOf[j] === zone;
    for (let k = 0; k < nz; k++) {
      for (let i = 0; i < nx; i++) {
        const idx = k * nx + i;
        if (open[idx] || used[idx]) continue;
        const zi = zoneOf[idx];
        let w = 1;
        while (i + w < nx && free(idx + w, zi)) w++;
        let h = 1;
        outer: while (k + h < nz) {
          for (let d = 0; d < w; d++) if (!free((k + h) * nx + i + d, zi)) break outer;
          h++;
        }
        for (let kk = k; kk < k + h; kk++) for (let ii = i; ii < i + w; ii++) used[kk * nx + ii] = 1;
        const zone = zi >= 0 ? this.wallZones[zi] : undefined;
        m.box(this.x0 + i * g, base, this.z0 + k * g, this.x0 + (i + w) * g, zone?.height ?? wallHeight, this.z0 + (k + h) * g, zone?.tex ?? defaultWall);
      }
    }
  }
}
