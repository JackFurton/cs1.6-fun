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

export interface CarveStyle {
  /** Texture for a slightly overhanging cap along every wall top. */
  cap?: string;
  /** Texture for a low ledge where floors meet walls. */
  skirting?: string;
  /** Split long walls into pieces about this long, each with its own height... */
  segment?: number;
  /** ...offset by one of these, so rooftops don't form one flat line. */
  jitter?: number[];
  /** Put shuttered windows (and the odd door) on outdoor walls, so long runs read as buildings. */
  facades?: boolean;
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

  build(m: MapBuilder, wallHeight: number, defaultWall: string, defaultFloor: string, base = -64, style: CarveStyle = {}): void {
    for (const r of this.rooms) {
      m.box(r.x0, base, r.z0, r.x1, r.y, r.z1, r.opts.floor ?? defaultFloor);
      if (r.opts.ceiling !== undefined) m.box(r.x0, r.opts.ceiling, r.z0, r.x1, wallHeight, r.z1, r.opts.ceilingTex ?? 'concrete_dark');
    }

    const g = this.grid;
    const nx = Math.round((this.x1 - this.x0) / g);
    const nz = Math.round((this.z1 - this.z0) / g);
    const open = new Uint8Array(nx * nz);
    const floorY = new Float32Array(nx * nz);
    const covered = new Uint8Array(nx * nz);
    for (const r of this.rooms) {
      const i0 = Math.max(0, Math.round((r.x0 - this.x0) / g));
      const i1 = Math.min(nx, Math.round((r.x1 - this.x0) / g));
      const k0 = Math.max(0, Math.round((r.z0 - this.z0) / g));
      const k1 = Math.min(nz, Math.round((r.z1 - this.z0) / g));
      for (let k = k0; k < k1; k++)
        for (let i = i0; i < i1; i++) {
          open[k * nx + i] = 1;
          floorY[k * nx + i] = r.y;
          covered[k * nx + i] = r.opts.ceiling !== undefined ? 1 : 0;
        }
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
        this.emitWall(m, this.x0 + i * g, this.z0 + k * g, this.x0 + (i + w) * g, this.z0 + (k + h) * g, base, zone?.height ?? wallHeight, zone?.tex ?? defaultWall, style);
      }
    }

    // Skirting: a low ledge wherever a floor meets a wall, merged into runs along each row/column.
    if (style.skirting || style.facades) {
      const sk = style.skirting;
      const run = (horizontal: boolean) => {
        const outer = horizontal ? nz : nx;
        const inner = horizontal ? nx : nz;
        for (let a = 0; a < outer; a++) {
          for (const side of [-1, 1]) {
            let start = -1;
            let y = 0;
            let runOutdoor = false;
            for (let b = 0; b <= inner; b++) {
              const idx = horizontal ? a * nx + b : b * nx + a;
              const nIdx = horizontal ? (a + side) * nx + b : b * nx + a + side;
              const nOk = horizontal ? a + side >= 0 && a + side < nz : a + side >= 0 && a + side < nx;
              const edge = b < inner && open[idx] && nOk && !open[nIdx];
              const outdoor = b < inner && !covered[idx];
              const cy = b < inner ? floorY[idx] : NaN;
              if (edge && start >= 0 && cy === y) continue;
              if (start >= 0) {
                // Close the run [start, b).
                const c0 = start * g;
                const c1 = b * g;
                const wall = (side > 0 ? a + 1 : a) * g;
                if (sk) {
                  if (horizontal) m.detail(this.x0 + c0, y, this.z0 + wall - 2, this.x0 + c1, y + 8, this.z0 + wall + 2, sk);
                  else m.detail(this.x0 + wall - 2, y, this.z0 + c0, this.x0 + wall + 2, y + 8, this.z0 + c1, sk);
                }
                if (style.facades && runOutdoor) {
                  // The wall behind this run: its zone tells us how tall it is.
                  const wi = horizontal ? (a + side) * nx + Math.min(inner - 1, start + 1) : Math.min(inner - 1, start + 1) * nx + a + side;
                  const zi = zoneOf[wi];
                  const top = (zi >= 0 ? this.wallZones[zi].height : undefined) ?? wallHeight;
                  this.facade(m, horizontal, this.x0 + c0, this.x0 + c1, this.z0 + c0, this.z0 + c1, horizontal ? this.z0 + wall : this.x0 + wall, side, y, top);
                }
                start = -1;
              }
              if (edge) {
                start = b;
                y = cy;
                runOutdoor = outdoor;
              }
            }
          }
        }
      };
      run(true);
      run(false);
    }
  }

  /**
   * Windows with shutters and sills every few hundred units along an outdoor wall face, and a
   * doorway on longer runs. All visual: 3u proud of the wall, no collision.
   */
  private facade(m: MapBuilder, horizontal: boolean, xa: number, xb: number, za: number, zb: number, wallAt: number, side: number, floor: number, top: number): void {
    const a0 = horizontal ? xa : za;
    const a1 = horizontal ? xb : zb;
    const len = a1 - a0;
    if (len < 200 || top - floor < 150) return;
    // Face of the wall is at wallAt; the room is on the -side side, so pieces stick out toward it.
    const out = -side;
    const put = (b0: number, b1: number, y0: number, y1: number, depth: number, tex: string) => {
      const f0 = wallAt;
      const f1 = wallAt + out * depth;
      if (horizontal) m.detail(b0, y0, Math.min(f0, f1), b1, y1, Math.max(f0, f1), tex);
      else m.detail(Math.min(f0, f1), y0, b0, Math.max(f0, f1), y1, b1, tex);
    };
    const count = Math.floor(len / 300);
    const hash = (n: number) => Math.abs(Math.floor(Math.sin(n * 91.7 + wallAt * 0.37) * 10000));
    const wy = floor + Math.min(150, top - floor - 70);
    for (let i = 0; i < count; i++) {
      const c = a0 + ((i + 0.5) * len) / count;
      if (hash(c) % 5 === 0) continue;
      // Window: dark glass, a sill below, wooden shutters either side.
      put(c - 22, c + 22, wy, wy + 52, 1, 'window_dark');
      put(c - 28, c + 28, wy - 5, wy, 5, 'trim_sand');
      if (hash(c + 1) % 2) {
        put(c - 40, c - 23, wy, wy + 52, 2, 'wood');
        put(c + 23, c + 40, wy, wy + 52, 2, 'wood');
      }
    }
    if (len > 700 && hash(a0) % 3 === 0) {
      // An old door at street level between windows.
      const c = a0 + len * 0.5 + 150;
      if (c + 40 < a1) {
        put(c - 32, c + 32, floor, floor + 110, 1, 'door');
        put(c - 40, c + 40, floor + 110, floor + 118, 4, 'trim_sand');
      }
    }
  }

  /** A wall block, optionally cut into segments with varied heights and a cap on each, for a skyline. */
  private emitWall(m: MapBuilder, x0: number, z0: number, x1: number, z1: number, base: number, height: number, tex: string, style: CarveStyle): void {
    const seg = style.segment ?? 0;
    const alongX = x1 - x0 >= z1 - z0;
    const len = alongX ? x1 - x0 : z1 - z0;
    const n = seg > 0 ? Math.max(1, Math.round(len / seg)) : 1;
    for (let i = 0; i < n; i++) {
      const a0 = (alongX ? x0 : z0) + (len * i) / n;
      const a1 = (alongX ? x0 : z0) + (len * (i + 1)) / n;
      const [bx0, bz0, bx1, bz1] = alongX ? [a0, z0, a1, z1] : [x0, a0, x1, a1];
      // Deterministic per position so the skyline is stable between loads.
      const jit = style.jitter ?? [0];
      const hash = Math.abs(Math.floor(Math.sin(bx0 * 12.9898 + bz0 * 78.233) * 43758.5453));
      const top = height + jit[hash % jit.length];
      m.box(bx0, base, bz0, bx1, top, bz1, tex);
      if (style.cap) m.detail(bx0 - 3, top, bz0 - 3, bx1 + 3, top + 7, bz1 + 3, style.cap);
    }
  }
}
