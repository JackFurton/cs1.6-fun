import { boxBrush, rampBrush, type Brush, type BrushOpts, type RampDir } from '../engine/brush';
import { Vec3 } from '../engine/vec';
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

  constructor(readonly name: string) {}

  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, tex: string, opts?: BrushOpts): this {
    this.brushes.push(boxBrush(...corners(x0, y0, z0, x1, y1, z1), tex, opts));
    return this;
  }

  ramp(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, dir: RampDir, tex: string, opts?: BrushOpts): this {
    this.brushes.push(rampBrush(...corners(x0, y0, z0, x1, y1, z1), dir, tex, opts));
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
