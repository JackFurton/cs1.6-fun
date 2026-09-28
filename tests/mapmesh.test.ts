import { expect, test } from 'vitest';
import { boxBrush, rampBrush } from '../src/engine/brush';
import { Vec3 } from '../src/engine/vec';
import { brushFaces } from '../src/client/mapmesh';
import { MAPS } from '../src/maps';

test('box brush has six quads', () => {
  const faces = brushFaces(boxBrush(new Vec3(0, 0, 0), new Vec3(64, 32, 16), 'crate'));
  expect(faces).toHaveLength(6);
  for (const f of faces) expect(f.verts).toHaveLength(4);
});

test('ramp drops its degenerate bevel faces', () => {
  const faces = brushFaces(rampBrush(new Vec3(0, 0, 0), new Vec3(256, 128, 64), '+x', 'ramp'));
  expect(faces).toHaveLength(5);
  const slope = faces.find((f) => f.normal.x < 0 && f.normal.y > 0)!;
  expect(slope.verts.map((v) => v.y).sort((a, b) => a - b)).toEqual([0, 0, 128, 128].map((n) => expect.closeTo(n, 3)));
});

test('every map has spawns for both teams', () => {
  for (const [name, make] of Object.entries(MAPS)) {
    const m = make();
    expect(m.spawns.T.length, name).toBeGreaterThanOrEqual(5);
    expect(m.spawns.CT.length, name).toBeGreaterThanOrEqual(5);
  }
});

test('spawns stand on ground and are not inside geometry', async () => {
  const { CollisionWorld } = await import('../src/engine/trace');
  const { HULL_STAND } = await import('../src/engine/pmove');
  for (const [name, make] of Object.entries(MAPS)) {
    const m = make();
    const world = new CollisionWorld(m.brushes);
    for (const s of [...m.spawns.T, ...m.spawns.CT]) {
      const p = s.pos.clone();
      p.y += 1;
      expect(world.trace(p, p, HULL_STAND.mins, HULL_STAND.maxs).startsolid, `${name} spawn ${p.x},${p.z}`).toBe(false);
      const down = p.clone();
      down.y -= 8;
      expect(world.trace(p, down, HULL_STAND.mins, HULL_STAND.maxs).fraction, `${name} spawn floor ${p.x},${p.z}`).toBeLessThan(1);
    }
    if (name.startsWith('de_')) expect(m.bombsites.length, name).toBe(2);
    else if (!m.bombsites.length) expect(m.weaponSpawns.length, name).toBeGreaterThan(0);
  }
});

test('octagonal prism renders 8 sides plus caps and blocks a box trace', async () => {
  const { prismBrush } = await import('../src/engine/brush');
  const { CollisionWorld } = await import('../src/engine/trace');
  const oct: [number, number][] = Array.from({ length: 8 }, (_, i) => [Math.cos((i / 8) * Math.PI * 2) * 32, Math.sin((i / 8) * Math.PI * 2) * 32]);
  const b = prismBrush(oct, 0, 64, 'metal');
  expect(brushFaces(b)).toHaveLength(10);
  const w = new CollisionWorld([b]);
  const mins = new Vec3(-16, 0, -16);
  const maxs = new Vec3(16, 72, 16);
  // Coming in along a diagonal, stop at the 45 degree face: centre ends ~32+16*sqrt2 from the axis, not at the bounding box corner.
  const t = w.trace(new Vec3(200, 1, 200), new Vec3(0, 1, 0), mins, maxs);
  expect(t.fraction).toBeLessThan(1);
  const r = Math.hypot(t.endpos.x, t.endpos.z);
  expect(r).toBeGreaterThan(40);
  expect(r).toBeLessThan(60);
});

test('detail brushes render but never collide', async () => {
  const { CollisionWorld } = await import('../src/engine/trace');
  const d = boxBrush(new Vec3(-50, 0, -50), new Vec3(50, 100, 50), 'trim', { detail: true });
  const w = new CollisionWorld([d]);
  expect(w.trace(new Vec3(-100, 10, 0), new Vec3(100, 10, 0)).fraction).toBe(1);
  expect(new CollisionWorld([d], { includeDetail: true }).trace(new Vec3(-100, 10, 0), new Vec3(100, 10, 0)).fraction).toBeLessThan(1);
});
