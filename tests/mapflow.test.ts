import { describe, expect, test } from 'vitest';
import { NavGraph } from '../src/bots/nav';
import { CollisionWorld } from '../src/engine/trace';
import { Vec3 } from '../src/engine/vec';
import { MAPS } from '../src/maps';
import type { MapData, Team } from '../src/maps/types';

/** Eye-height points across a team's spawn area: every spawn plus a grid over its buy zone. */
function spawnPoints(m: MapData, team: Team, world: CollisionWorld): Vec3[] {
  const pts = m.spawns[team].map((s) => s.pos.clone().add(new Vec3(0, 64, 0)));
  for (const z of m.buyzones[team]) {
    for (let x = z.min.x + 32; x < z.max.x; x += 96)
      for (let zz = z.min.z + 32; zz < z.max.z; zz += 96) {
        const top = new Vec3(x, 1000, zz);
        const t = world.trace(top, new Vec3(x, -200, zz));
        if (t.fraction < 1 && t.normal.y > 0.7) pts.push(t.endpos.clone().add(new Vec3(0, 64, 0)));
      }
  }
  return pts;
}

const competitive = Object.keys(MAPS).filter((n) => n.startsWith('de_'));

describe.each(competitive)('%s flow', (name) => {
  const m = MAPS[name]();
  const world = new CollisionWorld(m.brushes);

  test('neither spawn can see into the other', () => {
    const t = spawnPoints(m, 'T', world);
    const ct = spawnPoints(m, 'CT', world);
    const seen: string[] = [];
    for (const a of t) for (const b of ct) if (world.visible(a, b)) seen.push(`T(${a.x | 0},${a.z | 0}) -> CT(${b.x | 0},${b.z | 0})`);
    expect(seen.slice(0, 3), `${seen.length} sightlines`).toEqual([]);
  });

  test('spawns are a real walk apart', () => {
    const nav = new NavGraph(m, world);
    const path = nav.path(nav.nearest(m.spawns.T[0].pos)!, nav.nearest(m.spawns.CT[0].pos)!)!;
    let len = 0;
    for (let i = 1; i < path.length; i++) len += path[i].pos.distanceTo(path[i - 1].pos);
    // ~14s at knife speed before the teams can physically meet.
    expect(len).toBeGreaterThan(3500);
  });
});
