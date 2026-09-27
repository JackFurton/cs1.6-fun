import { describe, expect, test } from 'vitest';
import { NavGraph } from '../src/bots/nav';
import { CollisionWorld } from '../src/engine/trace';
import { Vec3 } from '../src/engine/vec';
import { MAPS } from '../src/maps';

describe.each(Object.keys(MAPS))('nav on %s', (name) => {
  const map = MAPS[name]();
  const t0 = performance.now();
  const nav = new NavGraph(map, new CollisionWorld(map.brushes));
  const ms = performance.now() - t0;

  test('builds quickly with a sane node count', () => {
    expect(nav.nodes.length).toBeGreaterThan(200);
    expect(ms).toBeLessThan(5000);
  });

  test('both spawns reach every bombsite', () => {
    for (const team of ['T', 'CT'] as const) {
      const from = nav.nearest(map.spawns[team][0].pos)!;
      for (const site of map.bombsites) {
        const c = new Vec3((site.min.x + site.max.x) / 2, 0, (site.min.z + site.max.z) / 2);
        const inside = nav.nodesIn(site);
        expect(inside.length, `${team}->${site.name}`).toBeGreaterThan(0);
        const to = inside.reduce((a, b) => (Math.hypot(a.pos.x - c.x, a.pos.z - c.z) < Math.hypot(b.pos.x - c.x, b.pos.z - c.z) ? a : b));
        expect(nav.path(from, to), `${team}->${site.name}`).not.toBeNull();
      }
    }
  });
});

test('dust2 T to A has two distinct routes (long and catwalk)', () => {
  const map = MAPS.de_dust2();
  const nav = new NavGraph(map, new CollisionWorld(map.brushes));
  const from = nav.nearest(map.spawns.T[0].pos)!;
  const a = map.bombsites.find((s) => s.name === 'A')!;
  const to = nav.nearest(new Vec3((a.min.x + a.max.x) / 2, 32, (a.min.z + a.max.z) / 2))!;
  const routes = nav.routes(from, to, 4);
  const areas = routes.map((r) => new Set(r.map((n) => n.area)));
  expect(areas.some((s) => s.has('Long A'))).toBe(true);
  expect(areas.some((s) => s.has('Catwalk'))).toBe(true);
});
