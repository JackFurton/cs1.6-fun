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
