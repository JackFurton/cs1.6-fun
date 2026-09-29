import { expect, test } from 'vitest';
import { findLineup } from '../src/bots/lineups';
import { CollisionWorld } from '../src/engine/trace';
import { Vec3 } from '../src/engine/vec';
import { simulateThrow } from '../src/game/grenades';
import { Game } from '../src/game/game';
import { MAPS } from '../src/maps';

test('lineup puts a smoke on a spot around a corner, and the live grenade agrees', () => {
  const map = MAPS.de_dust2();
  const world = new CollisionWorld(map.brushes);
  // From outside long, over the wall, onto the long doors.
  const eye = new Vec3(1000, 64 + 64, 2500);
  const target = new Vec3(1500, 0, 1300);
  const t0 = performance.now();
  const l = findLineup(world, 'smokegrenade', eye, target);
  const ms = performance.now() - t0;
  expect(l).not.toBeNull();
  expect(ms).toBeLessThan(400);
  // Throw it for real in a game and check it stops where the lineup said.
  const g = new Game(map);
  const p = g.addPlayer('p', 'T', false);
  p.move.origin.set(eye.x, eye.y - 64, eye.z);
  p.yaw = l!.yaw;
  p.pitch = l!.pitch;
  p.noclip = true;
  g.grenades.throw(p, 'smokegrenade');
  for (let i = 0; i < 600 && g.grenades.smokes.length === 0; i++) g.tick();
  const s = g.grenades.smokes[0];
  expect(s).toBeDefined();
  expect(Math.hypot(s.pos.x - l!.land.x, s.pos.z - l!.land.z)).toBeLessThan(2);
});

test('simulation matches live flashbang detonation point', () => {
  const map = MAPS.de_mirage();
  const world = new CollisionWorld(map.brushes);
  const eye = new Vec3(-200, 64, 0);
  const sim = simulateThrow(world, 'flashbang', eye, 30, 20);
  const g = new Game(map);
  const p = g.addPlayer('p', 'T', false);
  p.move.origin.set(eye.x, 0, eye.z);
  p.yaw = 30;
  p.pitch = 20;
  p.noclip = true;
  g.grenades.throw(p, 'flashbang');
  let at: Vec3 | null = null;
  for (let i = 0; i < 200 && !at; i++) {
    g.tick();
    for (const e of g.takeEvents()) if (e.type === 'flash') at = e.pos;
  }
  expect(at).not.toBeNull();
  expect(at!.distanceTo(sim)).toBeLessThan(1);
});
