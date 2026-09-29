import { describe, expect, test } from 'vitest';
import { Vec3 } from '../src/engine/vec';
import { Deathmatch } from '../src/game/deathmatch';
import { Game, TICK_DT } from '../src/game/game';
import { NUKE_FLIGHT_TIME } from '../src/game/nuke';
import type { Player } from '../src/game/player';
import { BombDefusal, DEFAULT_MATCH, ECON } from '../src/game/rules';
import { MapBuilder } from '../src/maps/builder';
import { applyPlayerState, decodeEvent, encodeEvent, snapshot } from '../src/net/protocol';

function setup() {
  const m = new MapBuilder('nuke-test');
  m.box(-12000, -16, -12000, 12000, 0, 12000, 'sand');
  m.box(400, 0, -300, 600, 800, 300, 'concrete');
  m.spawn('T', -2000, 0, 0).spawn('T', -2100, 0, 0);
  m.spawn('CT', 7000, 0, 0).spawn('CT', 7100, 0, 0);
  m.buyzone('T', -2300, -300, -1800, 300).buyzone('CT', 6800, -300, 7300, 300);
  m.bombsite('A', -1100, -200, -900, 200).bombsite('B', 900, -200, 1100, 200);
  const g = new Game(m.build({ sky: { top: 0, horizon: 0 }, sun: { dir: [0, -1, 0], color: 0, intensity: 1 }, ambient: 1 }));
  const owner = g.addPlayer('Operator', 'T', false);
  const mate = g.addPlayer('Teammate', 'T', false);
  const enemy = g.addPlayer('Distant armored CT', 'CT', false);
  const r = new BombDefusal(g, { ...DEFAULT_MATCH, freezeTime: 1, roundTime: 60 });
  g.rules = r;
  r.start();
  return { g, r, owner, mate, enemy };
}

function run(g: Game, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / TICK_DT); i++) g.tick();
}

function arm(g: Game, p: Player): void {
  g.equip(p, 'silencer');
  run(g, 1.2);
}

function fire(g: Game, p: Player): void {
  p.cmd.attack = true;
  g.tick();
  p.cmd.attack = false;
  g.tick();
}

describe('Silencer strategic launcher', () => {
  test('can be bought for the starting $800 and cannot fire during freeze time', () => {
    const { g, r, owner } = setup();
    expect(r.buy(owner, 'silencer')).toBeNull();
    expect(owner.money).toBe(ECON.start - 800);
    owner.nextAttack = 0;
    fire(g, owner);
    expect(g.nukes.strike).toBeNull();
    expect(owner.weapon?.clip).toBe(1);
    run(g, 1.2);
    fire(g, owner);
    expect(g.nukes.strike?.impactAt).toBe(g.nukes.strike!.launchedAt + 10);
    expect(owner.weapon?.clip).toBe(0);
  });

  test('secondary fire selects B; launch warns once and impacts exactly ten seconds later', () => {
    const { g, r, owner, mate, enemy } = setup();
    arm(g, owner);
    owner.cmd.attack2 = true;
    g.tick();
    owner.cmd.attack2 = false;
    run(g, 0.3);
    enemy.armor = mate.armor = owner.armor = 100;
    enemy.helmet = true;
    fire(g, owner);
    const strike = g.nukes.strike!;
    expect(strike.site).toBe('B');
    expect(strike.pos.x).toBe(1000);
    expect(strike.impactAt - strike.launchedAt).toBeCloseTo(NUKE_FLIGHT_TIME, 8);
    fire(g, owner);
    expect(g.takeEvents().filter((e) => e.type === 'nukeLaunch')).toHaveLength(1);

    g.time = strike.impactAt - TICK_DT;
    g.tick();
    expect(g.players.every((p) => p.alive)).toBe(true);
    g.tick();
    expect(g.players.every((p) => !p.alive)).toBe(true);
    expect(strike.exploded).toBe(true);
    expect(r.lastReason).toBe('nuke');
    expect(r.score).toEqual({ T: 1, CT: 0 });
    expect(g.takeEvents().filter((e) => e.type === 'nukeImpact')).toHaveLength(1);
    run(g, 0.5);
    expect(r.history).toHaveLength(1);
    expect(owner.mvps).toBe(1);
  });

  test('another launcher cannot replace a committed strike or consume its own charge', () => {
    const { g, owner, enemy } = setup();
    arm(g, owner);
    arm(g, enemy);
    fire(g, owner);
    const strike = g.nukes.strike;
    fire(g, enemy);
    expect(g.nukes.strike).toBe(strike);
    expect(enemy.weapon?.clip).toBe(1);
  });

  test('operator death and team elimination do not cancel the strike or end the round early', () => {
    const { g, r, owner, mate } = setup();
    arm(g, owner);
    fire(g, owner);
    const strike = g.nukes.strike!;
    g.kill(owner, null, 'world', false, false);
    g.kill(mate, null, 'world', false, false);
    run(g, 6);
    expect(r.phase).toBe('live');
    expect(r.history).toHaveLength(0);
    g.time = strike.impactAt;
    g.tick();
    expect(r.lastWinner).toBe('T');
    expect(r.lastReason).toBe('nuke');
  });

  test('the launching CT team wins and uses the normal five-second round transition', () => {
    const { g, r, enemy } = setup();
    arm(g, enemy);
    fire(g, enemy);
    const strike = g.nukes.strike!;
    g.time = strike.impactAt;
    g.tick();
    expect(r.score).toEqual({ T: 0, CT: 1 });
    expect(g.dropped).toHaveLength(0);
    expect(r.phaseEnd - strike.impactAt).toBeCloseTo(5);
    run(g, 4.9);
    expect(r.phase).toBe('over');
    expect(g.players.every((p) => !p.alive)).toBe(true);
    run(g, 0.2);
    expect(r.round).toBe(2);
    expect(r.phase).toBe('freeze');
    expect(g.nukes.strike).toBeNull();
    expect(g.players.every((p) => p.alive)).toBe(true);
  });

  test('round timeout and C4 results cannot interrupt a committed launch', () => {
    const { g, r, owner } = setup();
    arm(g, owner);
    fire(g, owner);
    r.phaseEnd = g.time;
    r.endRound('CT', 'defuse');
    g.tick();
    expect(r.phase).toBe('live');
    expect(r.history).toHaveLength(0);
    g.time = g.nukes.strike!.impactAt;
    g.tick();
    expect(r.lastReason).toBe('nuke');
  });

  test('deathmatch respawns normally before and after impact, restoring the map for play', () => {
    const { g, owner, enemy } = setup();
    const dm = new Deathmatch(g);
    g.rules = dm;
    dm.start();
    arm(g, owner);
    fire(g, owner);
    const strike = g.nukes.strike!;
    g.kill(owner, enemy, 'ak47', false, false);
    run(g, 2.1);
    expect(owner.alive).toBe(true);
    expect(g.nukes.strike).toBe(strike);
    g.time = strike.impactAt;
    g.tick();
    run(g, 1.9);
    expect(g.players.every((p) => !p.alive)).toBe(true);
    run(g, 0.2);
    expect(g.nukes.strike).toBeNull();
    expect(g.players.every((p) => p.alive)).toBe(true);
  });

  test('snapshots preserve selected target and active strike for late joiners', () => {
    const { g, owner, enemy } = setup();
    arm(g, owner);
    owner.weapon!.targetSite = 1;
    fire(g, owner);
    const s = JSON.parse(JSON.stringify(snapshot(g, new Map())));
    expect(s.nuke.site).toBe('B');
    expect(s.nuke.impactAt - s.nuke.launchedAt).toBe(10);
    expect(s.nuke.pos).toHaveLength(3);
    applyPlayerState(enemy, s.players[0]);
    expect(enemy.weapon?.targetSite).toBe(1);
    const event = g.takeEvents().find((e) => e.type === 'nukeLaunch')!;
    const decoded = decodeEvent(JSON.parse(JSON.stringify(encodeEvent(event))), () => undefined) as typeof event;
    expect({ ...decoded, pos: event.pos }).toEqual(event);
    expect(decoded.pos).toBeInstanceOf(Vec3);
    expect(decoded.pos.distanceTo(event.pos)).toBeLessThan(0.01);
  });
});
