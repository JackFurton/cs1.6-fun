import { describe, expect, test } from 'vitest';
import { MapBuilder } from '../src/maps/builder';
import { Game, TICK_DT } from '../src/game/game';
import { armorAbsorb, applyHitGroup, currentSpread } from '../src/game/combat';
import { rayHitBody } from '../src/game/hitbox';
import { Vec3, yawTo } from '../src/engine/vec';
import { WEAPONS } from '../src/game/weapons';

function testMap(wallThickness = 8, tex = 'wood') {
  const m = new MapBuilder('test');
  m.box(-2048, -16, -2048, 2048, 0, 2048, 'sand');
  if (wallThickness > 0) m.box(-200, 0, -400, 200, 128, -400 - wallThickness, tex);
  for (let i = 0; i < 5; i++) m.spawn('CT', i * 40, 0, 0).spawn('T', i * 40, -800, 180);
  return m.build({ sky: { top: 0, horizon: 0 }, sun: { dir: [0, -1, 0], color: 0, intensity: 1 }, ambient: 1 });
}

function setup(wall = 8, tex = 'wood') {
  const g = new Game(testMap(wall, tex));
  g.rand = () => 0.5;
  const ct = g.addPlayer('ct', 'CT', false);
  const t = g.addPlayer('t', 'T', true);
  g.spawn(ct, 0);
  g.spawn(t, 0);
  return { g, ct, t };
}

function aimAt(g: Game, from: ReturnType<typeof setup>['ct'], target: Vec3) {
  const eye = from.eye();
  from.cmd.yaw = yawTo(eye, target);
  from.cmd.pitch = (Math.atan2(target.y - eye.y, Math.hypot(target.x - eye.x, target.z - eye.z)) * 180) / Math.PI;
  void g;
}

describe('damage model', () => {
  test('AK one-taps a helmeted head, M4 does not', () => {
    const ak = applyHitGroup(36, 'head');
    expect(armorAbsorb(ak, 100, WEAPONS.ak47.armorPen).health).toBeGreaterThan(100);
    const m4 = applyHitGroup(32, 'head');
    expect(armorAbsorb(m4, 100, WEAPONS.m4a1.armorPen).health).toBeLessThan(100);
  });

  test('AWP legs does not kill', () => {
    expect(applyHitGroup(115, 'legs')).toBeLessThan(100);
    expect(armorAbsorb(115, 100, WEAPONS.awp.armorPen).health).toBeGreaterThan(100);
  });

  test('hitboxes: head, legs, miss', () => {
    const origin = new Vec3(0, 0, 0);
    const head = rayHitBody(new Vec3(0, 64, 500), new Vec3(0, 0, -1), 1000, origin, 0, 0);
    expect(head?.group).toBe('head');
    const legs = rayHitBody(new Vec3(0, 20, 500), new Vec3(0, 0, -1), 1000, origin, 0, 0);
    expect(legs?.group).toBe('legs');
    expect(rayHitBody(new Vec3(40, 50, 500), new Vec3(0, 0, -1), 1000, origin, 0, 0)).toBeNull();
    // Crouched, the old head height is empty air.
    expect(rayHitBody(new Vec3(0, 64, 500), new Vec3(0, 0, -1), 1000, origin, 0, 1)).toBeNull();
  });
});

describe('shooting', () => {
  test('first AK bullet standing still is accurate, spraying is not', () => {
    const { g, ct } = setup();
    g.equip(ct, 'ak47');
    const w = ct.weapon!;
    expect(currentSpread(ct, w)).toBeLessThan(0.01);
    w.shotsFired = 10;
    expect(currentSpread(ct, w)).toBeGreaterThan(0.03);
    ct.move.onGround = false;
    expect(currentSpread(ct, w)).toBeGreaterThan(0.3);
  });

  test('spraying kicks the view up and it recovers', () => {
    const { g, ct } = setup();
    g.equip(ct, 'ak47');
    g.time = 5;
    ct.nextAttack = 0;
    ct.cmd.attack = true;
    for (let i = 0; i < 100; i++) g.tick();
    expect(ct.weapon!.clip).toBeLessThan(25);
    expect(ct.punchPitch).toBeGreaterThan(3);
    ct.cmd.attack = false;
    for (let i = 0; i < 100; i++) g.tick();
    expect(ct.punchPitch).toBeLessThan(0.01);
  });

  test('headshot kills and drops the gun', () => {
    const { g, ct, t } = setup(0);
    g.equip(ct, 'deagle');
    g.time = 5;
    ct.nextAttack = 0;
    t.armor = 100;
    t.helmet = true;
    aimAt(g, ct, t.eye());
    ct.cmd.attack = true;
    g.tick();
    expect(t.alive).toBe(false);
    const kill = g.takeEvents().find((e) => e.type === 'kill');
    expect(kill && kill.type === 'kill' && kill.headshot).toBe(true);
    expect(g.dropped.some((d) => d.state.def.id === 'glock')).toBe(true);
  });

  test('wallbangs depend on gun, thickness and material', () => {
    for (const [wall, tex, weapon, expectHit] of [
      [12, 'door', 'ak47', true],
      [12, 'door', 'glock', true],
      [64, 'wood', 'glock', false],
      [16, 'plaster', 'ak47', true],
      [40, 'plaster', 'ak47', false],
      [16, 'stone', 'ak47', false],
      [20, 'plaster', 'awp', true],
    ] as const) {
      const { g, ct, t } = setup(wall, tex);
      g.equip(ct, weapon);
      // A freshly drawn semi-auto needs the trigger released once.
      g.tick();
      g.time = 5;
      ct.nextAttack = 0;
      aimAt(g, ct, t.origin.clone().add(new Vec3(0, 50, 0)));
      ct.cmd.attack = true;
      g.tick();
      expect(t.health < 100, `${weapon} through ${wall}u ${tex}`).toBe(expectHit);
    }
  });

  test('getting shot slows you down (tagging)', () => {
    const { g, ct, t } = setup(0);
    g.equip(ct, 'ak47');
    g.time = 5;
    ct.nextAttack = 0;
    t.cmd.forward = 1;
    t.cmd.yaw = 90;
    for (let i = 0; i < 100; i++) g.tick();
    const before = t.move.velocity.length2d();
    aimAt(g, ct, t.origin.clone().add(new Vec3(0, 20, 0)));
    ct.cmd.attack = true;
    g.tick();
    ct.cmd.attack = false;
    for (let i = 0; i < 5; i++) g.tick();
    expect(t.health).toBeLessThan(100);
    expect(t.move.velocity.length2d()).toBeLessThan(before * 0.5);
    void TICK_DT;
  });

  test('knife backstab kills', () => {
    const { g, ct, t } = setup(0);
    t.move.origin.set(0, 0, -30);
    t.yaw = t.cmd.yaw = 0; // facing away from ct at z=0
    ct.active = 'knife';
    g.time = 5;
    ct.nextAttack = 0;
    aimAt(g, ct, t.origin.clone().add(new Vec3(0, 50, 0)));
    ct.cmd.attack2 = true;
    g.tick();
    expect(t.alive).toBe(false);
  });
});
