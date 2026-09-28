import { boxBrush, prismBrush, rampBrush, type Brush, type BrushOpts, type RampDir } from '../engine/brush';
import { Vec3 } from '../engine/vec';
import type { WeaponId } from '../game/weapons';
import type { MapData, Spawn, Team, Zone } from './types';

/**
 * Maps are authored top-down: x runs east, z runs south, y is height. Every call takes
 * two corners in any order.
 */
export class MapBuilder {
  readonly brushes: Brush[] = [];
  readonly spawns: Record<Team, Spawn[]> = { T: [], CT: [] };
  readonly bombsites: Zone[] = [];
  readonly buyzones: Record<Team, Zone[]> = { T: [], CT: [] };
  readonly callouts: Zone[] = [];
  readonly weaponSpawns: MapData['weaponSpawns'] = [];

  constructor(readonly name: string) {}

  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, tex: string, opts?: BrushOpts): this {
    this.brushes.push(boxBrush(...corners(x0, y0, z0, x1, y1, z1), tex, opts));
    return this;
  }

  ramp(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, dir: RampDir, tex: string, opts?: BrushOpts): this {
    this.brushes.push(rampBrush(...corners(x0, y0, z0, x1, y1, z1), dir, tex, opts));
    return this;
  }

  /** Vertical prism from a convex XZ polygon: diagonal walls, chamfers, odd-shaped cover. */
  prism(points: [number, number][], y0: number, y1: number, tex: string, opts?: BrushOpts): this {
    this.brushes.push(prismBrush(points, y0, y1, tex, opts));
    return this;
  }

  /** Visual-only box (trims, beams, awnings); players and bullets pass through. */
  detail(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, tex: string): this {
    return this.box(x0, y0, z0, x1, y1, z1, tex, { detail: true });
  }

  /** Regular n-gon pillar or column. */
  pillar(x: number, z: number, r: number, y0: number, y1: number, tex: string, sides = 8, opts?: BrushOpts): this {
    const pts: [number, number][] = Array.from({ length: sides }, (_, i) => {
      const a = (i / sides) * Math.PI * 2 + Math.PI / sides;
      return [x + Math.cos(a) * r, z + Math.sin(a) * r];
    });
    return this.prism(pts, y0, y1, tex, opts);
  }

  /** Oil drum, 1.6's favourite prop. Standing waist high, so it's cover you can jump on. */
  barrel(x: number, z: number, y = 0, tex = 'barrel_red'): this {
    return this.pillar(x, z, 14, y, y + 44, tex, 8).detail(x - 15, y + 44, z - 15, x + 15, y + 46, z + 15, 'metal');
  }

  /** Cut a corner off at 45 degrees: a triangle filling the corner at (x, z) with legs of `size`. */
  chamfer(x: number, z: number, size: number, corner: 'ne' | 'nw' | 'se' | 'sw', y0: number, y1: number, tex: string): this {
    const sx = corner.endsWith('e') ? -1 : 1;
    const sz = corner.startsWith('n') ? 1 : -1;
    return this.prism(
      [
        [x, z],
        [x + sx * size, z],
        [x, z + sz * size],
      ],
      y0,
      y1,
      tex,
    );
  }

  /** Low wall of sandbags: waist-high cover that stops bullets. */
  sandbags(x0: number, z0: number, x1: number, z1: number, y = 0, h = 36): this {
    this.box(x0, y, z0, x1, y + h, z1, 'sandbag');
    // Rounded-looking top row sitting slightly proud.
    const along = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    return along ? this.detail(x0 + 4, y + h, (z0 + z1) / 2 - 6, x1 - 4, y + h + 5, (z0 + z1) / 2 + 6, 'sandbag') : this.detail((x0 + x1) / 2 - 6, y + h, z0 + 4, (x0 + x1) / 2 + 6, y + h + 5, z1 - 4, 'sandbag');
  }

  /** Parked car: body you can hide behind, a cabin, wheels. `alongX` sets which way it points. */
  car(x: number, z: number, alongX: boolean, y = 0, tex = 'car_white'): this {
    const [hl, hw] = alongX ? [80, 36] : [36, 80];
    this.box(x - hl, y + 10, z - hw, x + hl, y + 42, z + hw, tex);
    const [cl, cw] = alongX ? [40, 32] : [32, 40];
    this.box(x - cl, y + 42, z - cw, x + cl, y + 66, z + cw, tex);
    this.detail(x - cl - 1, y + 46, z - cw - 1, x + cl + 1, y + 62, z + cw + 1, 'window_dark');
    for (const a of [-1, 1])
      for (const b of [-1, 1]) {
        const wx = alongX ? x + a * (hl - 22) : x + b * (hw - 2);
        const wz = alongX ? z + b * (hw - 2) : z + a * (hl - 22);
        this.detail(wx - (alongX ? 12 : 6), y, wz - (alongX ? 6 : 12), wx + (alongX ? 12 : 6), y + 24, wz + (alongX ? 6 : 12), 'tire');
      }
    return this;
  }

  /**
   * Arch over an opening in a wall: a lintel with sloped haunches either side, so doorways
   * read as dust-style arches rather than rectangular holes. The opening must already be
   * walkable (carved), with walls either side of it.
   */
  arch(x0: number, z0: number, x1: number, z1: number, floorY: number, height: number, wallTop: number, tex: string): this {
    const alongX = Math.abs(x1 - x0) >= Math.abs(z1 - z0);
    const lo = Math.min(alongX ? x0 : z0, alongX ? x1 : z1);
    const hi = Math.max(alongX ? x0 : z0, alongX ? x1 : z1);
    const t0 = Math.min(alongX ? z0 : x0, alongX ? z1 : x1);
    const t1 = Math.max(alongX ? z0 : x0, alongX ? z1 : x1);
    const top = floorY + height;
    const w = Math.min(48, (hi - lo) / 3);
    const B = (a0: number, y0: number, a1: number, y1: number): [Vec3, Vec3] => (alongX ? corners(a0, y0, t0, a1, y1, t1) : corners(t0, y0, a0, t1, y1, a1));
    // Lintel above the opening, up to the wall top.
    if (wallTop > top) this.brushes.push(boxBrush(...B(lo, top, hi, wallTop), tex));
    // Haunches: wedges hanging from the lintel whose sloped faces look down into the opening.
    const axis = alongX ? 'x' : 'z';
    this.brushes.push(rampBrush(...B(lo, top - w, lo + w, top), `+${axis}` as RampDir, tex, {}, true));
    this.brushes.push(rampBrush(...B(hi - w, top - w, hi, top), `-${axis}` as RampDir, tex, {}, true));
    // Keystone-coloured trim along the face of the lintel.
    const [a, b] = B(lo - 6, top, hi + 6, top + 6);
    const pad = alongX ? new Vec3(0, 0, 2) : new Vec3(2, 0, 0);
    return this.detail(a.x - pad.x, a.y, a.z - pad.z, b.x + pad.x, b.y, b.z + pad.z, 'trim_sand');
  }

  /** Sloping awning over a doorway or wall, visual only. The high edge is on the `dir` side (against the wall). */
  awning(x0: number, z0: number, x1: number, z1: number, y: number, dir: RampDir, tex = 'wood'): this {
    this.brushes.push(rampBrush(...corners(x0, y, z0, x1, y + 14, z1), dir, tex, { detail: true }));
    return this;
  }

  /** A wooden crate of the given size sitting at y. */
  crate(x: number, z: number, size = 64, y = 0, tex = 'crate'): this {
    const h = size / 2;
    return this.box(x - h, y, z - h, x + h, y + size, z + h, tex, { fit: true, penetration: 1 });
  }

  /** Solid stairs climbing toward `dir`, one column per step. */
  stairs(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, dir: RampDir, tex: string, stepHeight = 16): this {
    const steps = Math.max(1, Math.round((y1 - y0) / stepHeight));
    const axis = dir[1] as 'x' | 'z';
    const lo = axis === 'x' ? Math.min(x0, x1) : Math.min(z0, z1);
    const hi = axis === 'x' ? Math.max(x0, x1) : Math.max(z0, z1);
    const run = (hi - lo) / steps;
    for (let i = 0; i < steps; i++) {
      const h = y0 + ((y1 - y0) * (i + 1)) / steps;
      const a = dir[0] === '+' ? lo + run * i : hi - run * (i + 1);
      if (axis === 'x') this.box(a, y0, z0, a + run, h, z1, tex);
      else this.box(x0, y0, a, x1, h, a + run, tex);
    }
    return this;
  }

  /** Invisible player clip, e.g. to smooth out geometry or seal the skybox. */
  clip(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): this {
    return this.box(x0, y0, z0, x1, y1, z1, 'clip', { clip: true });
  }

  spawn(team: Team, x: number, z: number, yaw: number, y = 0): this {
    this.spawns[team].push({ pos: new Vec3(x, y, z), yaw });
    return this;
  }

  bombsite(name: string, x0: number, z0: number, x1: number, z1: number, y0 = -64, y1 = 256): this {
    this.bombsites.push(zone(name, x0, y0, z0, x1, y1, z1));
    return this;
  }

  buyzone(team: Team, x0: number, z0: number, x1: number, z1: number): this {
    this.buyzones[team].push(zone(team, x0, -512, z0, x1, 1024, z1));
    return this;
  }

  /** A gun lying on the floor each round, fy_ style. */
  weapon(id: WeaponId, x: number, z: number, y = 0): this {
    this.weaponSpawns.push({ id, pos: new Vec3(x, y + 2, z) });
    return this;
  }

  callout(name: string, x0: number, z0: number, x1: number, z1: number, y0 = -512, y1 = 1024): this {
    this.callouts.push(zone(name, x0, y0, z0, x1, y1, z1));
    return this;
  }

  build(extra: Pick<MapData, 'sky' | 'sun' | 'ambient' | 'fog'>): MapData {
    return {
      name: this.name,
      brushes: this.brushes,
      spawns: this.spawns,
      bombsites: this.bombsites,
      buyzones: this.buyzones,
      callouts: this.callouts,
      weaponSpawns: this.weaponSpawns,
      ...extra,
    };
  }
}

function corners(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): [Vec3, Vec3] {
  return [new Vec3(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)), new Vec3(Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1))];
}

function zone(name: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Zone {
  const [min, max] = corners(x0, y0, z0, x1, y1, z1);
  return { name, min, max };
}
