import { describe, expect, test } from 'vitest';
import { Vec3 } from '../src/engine/vec';
import { Game, TICK_DT } from '../src/game/game';
import { BombDefusal, DEFAULT_MATCH, ECON } from '../src/game/rules';
import { MapBuilder } from '../src/maps/builder';

function map() {
  const m = new MapBuilder('rules');
  m.box(-4096, -16, -4096, 4096, 0, 4096, 'sand');
  for (let i = 0; i < 5; i++) m.spawn('T', -2000 + i * 40, 0, 0).spawn('CT', 2000 + i * 40, 0, 0);
  m.buyzone('T', -2200, -200, -1800, 200).buyzone('CT', 1800, -200, 2300, 200);
  m.bombsite('A', -1000, -300, -600, 300);
  return m.build({ sky: { top: 0, horizon: 0 }, sun: { dir: [0, -1, 0], color: 0, intensity: 1 }, ambient: 1 });
}

function setup(nT = 2, nCT = 2) {
  const g = new Game(map());
  g.rand = () => 0;
  for (let i = 0; i < nT; i++) g.addPlayer(`t${i}`, 'T', true);
  for (let i = 0; i < nCT; i++) g.addPlayer(`ct${i}`, 'CT', true);
  const r = new BombDefusal(g, { ...DEFAULT_MATCH, freezeTime: 1, roundTime: 20, c4Timer: 10 });
  g.rules = r;
  r.start();
  return { g, r };
}

const run = (g: Game, seconds: number) => {
  for (let i = 0; i < seconds / TICK_DT; i++) g.tick();
};
const team = (g: Game, t: 'T' | 'CT') => g.players.filter((p) => p.team === t);

describe('bomb defusal', () => {
  test('freeze time blocks movement, then the round goes live', () => {
    const { g, r } = setup();
    const p = team(g, 'CT')[0];
    const start = p.origin.clone();
    p.cmd.forward = 1;
    run(g, 0.5);
    expect(p.origin.distanceTo(start)).toBeLessThan(1);
    expect(r.phase).toBe('freeze');
    run(g, 1);
    expect(r.phase).toBe('live');
    expect(p.origin.distanceTo(start)).toBeGreaterThan(10);
  });

  test('one T gets the bomb', () => {
    const { g } = setup(3, 1);
    expect(team(g, 'T').filter((p) => p.weapons.c4)).toHaveLength(1);
  });

  test('elimination win pays winners, loss bonus to losers, kills pay 300', () => {
    const { g, r } = setup();
    run(g, 1.1);
    const [ct0] = team(g, 'CT');
    for (const t of team(g, 'T')) g.kill(t, ct0, 'ak47', false, false);
    g.tick();
    expect(r.phase).toBe('over');
    expect(r.score.CT).toBe(1);
    expect(ct0.money).toBe(ECON.start + 2 * ECON.kill + ECON.winElimination);
    expect(team(g, 'T')[0].money).toBe(ECON.start + ECON.lossBase);
  });

  test('loss bonus grows each consecutive loss and caps', () => {
    const { g, r } = setup();
    const bonuses: number[] = [];
    for (let round = 0; round < 6; round++) {
      run(g, 1.1);
      const t = team(g, 'T')[0];
      t.money = 0;
      const before = t.money;
      for (const x of team(g, 'T')) g.kill(x, null, 'world', false, false);
      g.tick();
      bonuses.push(t.money - before);
      run(g, 5.1);
      void r;
    }
    expect(bonuses).toEqual([1400, 1900, 2400, 2900, 3400, 3400]);
  });

  test('plant in site, bomb explodes, T win', () => {
    const { g, r } = setup();
    run(g, 1.1);
    const c = r.carrier!;
    c.move.origin.set(-800, 1, 0);
    c.cmd.slot = 'c4';
    run(g, 0.1);
    c.cmd.attack = true;
    run(g, 3.2);
    expect(r.bomb).not.toBeNull();
    expect(r.bomb!.site).toBe('A');
    c.cmd.attack = false;
    const near = team(g, 'CT')[0];
    near.move.origin.set(-850, 1, 100);
    run(g, 10.1);
    expect(r.bomb!.exploded).toBe(true);
    expect(near.alive).toBe(false);
    expect(r.lastWinner).toBe('T');
    expect(r.lastReason).toBe('bomb');
  });

  test('releasing attack cancels the plant', () => {
    const { g, r } = setup();
    run(g, 1.1);
    const c = r.carrier!;
    c.move.origin.set(-800, 1, 0);
    c.cmd.slot = 'c4';
    run(g, 0.1);
    c.cmd.attack = true;
    run(g, 2);
    c.cmd.attack = false;
    run(g, 2);
    expect(r.bomb).toBeNull();
  });

  test('defuse with a kit takes 5 seconds and wins for CT', () => {
    const { g, r } = setup();
    run(g, 1.1);
    const c = r.carrier!;
    c.move.origin.set(-800, 1, 0);
    c.cmd.slot = 'c4';
    run(g, 0.1);
    c.cmd.attack = true;
    run(g, 3.2);
    c.cmd.attack = false;
    for (const t of team(g, 'T')) g.kill(t, null, 'world', false, false);
    expect(r.phase).toBe('live');
    const ct = team(g, 'CT')[0];
    ct.defuser = true;
    ct.move.origin.copy(r.bomb!.pos).add(new Vec3(30, 1, 0));
    ct.cmd.use = true;
    run(g, 4.5);
    expect(r.phase).toBe('live');
    run(g, 0.6);
    expect(r.bomb!.defused).toBe(true);
    expect(r.lastReason).toBe('defuse');
  });

  test('running out the clock is a CT win and hiding Ts get nothing', () => {
    const { g, r } = setup();
    run(g, 1.1);
    const t = team(g, 'T')[0];
    const before = t.money;
    run(g, 20.1);
    expect(r.lastWinner).toBe('CT');
    expect(r.lastReason).toBe('time');
    expect(t.money).toBe(before);
  });

  test('buying: buy zone, team restrictions, funds', () => {
    const { g, r } = setup();
    const t = team(g, 'T')[0];
    const ct = team(g, 'CT')[0];
    expect(r.buy(t, 'm4a1')).toMatch(/team/);
    expect(r.buy(t, 'ak47')).toMatch(/insufficient/);
    expect(r.buy(t, 'vest')).toBeNull();
    expect(t.armor).toBe(100);
    expect(r.buy(ct, 'defuser')).toBeNull();
    ct.move.origin.set(0, 1, 0);
    expect(r.buy(ct, 'vest')).toMatch(/buy zone/);
  });

  test('dead players lose their guns, survivors keep them', () => {
    const { g, r } = setup();
    const [t0, t1] = team(g, 'T');
    t0.money = t1.money = 10000;
    expect(r.buy(t0, 'ak47')).toBeNull();
    expect(r.buy(t1, 'ak47')).toBeNull();
    run(g, 1.1);
    g.kill(t1, null, 'world', false, false);
    for (const ct of team(g, 'CT')) g.kill(ct, t0, 'ak47', false, false);
    run(g, 5.1);
    expect(r.round).toBe(2);
    expect(t0.weapons.primary?.def.id).toBe('ak47');
    expect(t1.weapons.primary).toBeUndefined();
  });
});

describe('1.6 details', () => {
  test('armor prices follow 1.6', () => {
    const { r } = setup();
    const p = r['g'].players[0];
    p.armor = 0;
    p.helmet = false;
    expect(r.armorCost(p, 'vesthelm')).toBe(1000);
    p.armor = 100;
    expect(r.armorCost(p, 'vesthelm')).toBe(350);
    p.armor = 60;
    p.helmet = true;
    expect(r.armorCost(p, 'vesthelm')).toBe(650);
    expect(r.armorCost(p, 'vest')).toBe(650);
    p.armor = 100;
    expect(r.armorCost(p, 'vesthelm')).toBeNull();
  });

  test('nobody can fire during freeze time', () => {
    const { g, r } = setup();
    const p = team(g, 'CT')[0];
    g.equip(p, 'ak47');
    p.nextAttack = 0;
    p.cmd.attack = true;
    run(g, 0.5);
    expect(r.phase).toBe('freeze');
    expect(p.weapon!.clip).toBe(30);
    run(g, 1);
    expect(r.phase).toBe('live');
    expect(p.weapon!.clip).toBeLessThan(30);
  });
});
