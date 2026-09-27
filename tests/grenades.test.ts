import { describe, expect, test } from 'vitest';
import { Vec3 } from '../src/engine/vec';
import { Game, TICK_DT } from '../src/game/game';
import { throwVelocity } from '../src/game/grenades';
import { MapBuilder } from '../src/maps/builder';

function setup() {
  const m = new MapBuilder('g');
  m.box(-4096, -16, -4096, 4096, 0, 4096, 'sand');
  for (let i = 0; i < 5; i++) m.spawn('CT', i * 40, 0, 0).spawn('T', i * 40, -600, 180);
  const g = new Game(m.build({ sky: { top: 0, horizon: 0 }, sun: { dir: [0, -1, 0], color: 0, intensity: 1 }, ambient: 1 }));
  g.rand = () => 0.5;
  const ct = g.addPlayer('ct', 'CT', false);
  const t = g.addPlayer('t', 'T', true);
  g.spawn(ct, 0);
  g.spawn(t, 0);
  g.time = 5;
  return { g, ct, t };
}

const run = (g: Game, s: number) => {
  for (let i = 0; i < s / TICK_DT; i++) g.tick();
};

function throwAt(g: Game, p: ReturnType<typeof setup>['ct'], id: 'hegrenade' | 'flashbang' | 'smokegrenade', pitch: number) {
  g.equip(p, id);
  p.cmd.slot = 'grenade';
  run(g, 0.6);
  p.cmd.pitch = pitch;
  p.cmd.attack = true;
  g.tick();
  p.cmd.attack = false;
  g.tick();
}

describe('grenades', () => {
  test('1.6 throw: level aim goes 600 u/s, 10 degrees up', () => {
    const v = throwVelocity(0, 0, new Vec3());
    expect(v.length()).toBeCloseTo(600, 0);
    expect(v.y).toBeGreaterThan(0);
    // Looking down lobs it short, looking up throws hardest.
    expect(throwVelocity(0, -60, new Vec3()).length()).toBeLessThan(300);
    expect(throwVelocity(0, 45, new Vec3()).length()).toBeCloseTo(750, 0);
  });

  test('HE lands near an enemy and hurts them; the slot empties after', () => {
    const { g, ct, t } = setup();
    t.move.origin.set(0, 1, -450);
    throwAt(g, ct, 'hegrenade', -5);
    expect(ct.weapons.grenade).toBeUndefined();
    run(g, 2);
    expect(t.health).toBeLessThan(100);
  });

  test('flashbang blinds a player looking at it', () => {
    const { g, ct, t } = setup();
    t.move.origin.set(0, 1, -1000);
    t.yaw = t.cmd.yaw = 180; // facing the CT, with the flash landing in between
    throwAt(g, ct, 'flashbang', 0);
    run(g, 1.6);
    expect(t.flashUntil).toBeGreaterThan(g.time + 1);
  });

  test('smoke blocks line of sight through it', () => {
    const { g, ct } = setup();
    throwAt(g, ct, 'smokegrenade', 10);
    run(g, 4);
    expect(g.grenades.smokes).toHaveLength(1);
    const s = g.grenades.smokes[0].pos;
    const a = s.clone().add(new Vec3(-400, 0, 0));
    const b = s.clone().add(new Vec3(400, 0, 0));
    expect(g.grenades.smokeBlocks(a, b)).toBe(true);
    expect(g.grenades.smokeBlocks(a.clone().add(new Vec3(0, 0, 400)), b.clone().add(new Vec3(0, 0, 400)))).toBe(false);
  });

  test('pressing 4 again cycles grenade types', () => {
    const { g, ct } = setup();
    g.equip(ct, 'flashbang');
    g.equip(ct, 'hegrenade');
    ct.cmd.slot = 'grenade';
    g.tick();
    const first = ct.weapons.grenade!.def.id;
    ct.cmd.slot = 'grenade';
    g.tick();
    expect(ct.weapons.grenade!.def.id).not.toBe(first);
  });
});
