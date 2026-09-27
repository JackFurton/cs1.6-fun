import { expect, test } from 'vitest';
import { BotManager } from '../src/bots/manager';
import type { Difficulty } from '../src/bots/skill';
import { Game, TICK_DT } from '../src/game/game';
import { BombDefusal } from '../src/game/rules';
import { MAPS } from '../src/maps';

/** Runs a bots-only match and returns what happened. */
export function simulate(mapName: string, rounds: number, seed = 1, diff: Difficulty = 'normal') {
  let s = seed;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const g = new Game(MAPS[mapName]());
  g.rand = rand;
  for (let i = 0; i < 5; i++) g.addPlayer(`t${i}`, 'T', true);
  for (let i = 0; i < 5; i++) g.addPlayer(`ct${i}`, 'CT', true);
  const r = new BombDefusal(g);
  g.rules = r;
  r.start();
  const mgr = new BotManager(g, r, diff);
  const stats = { rounds: [] as string[], kills: 0, headshots: 0, plants: 0, defuses: 0, explosions: 0, stuckTicks: 0, aliveTicks: 0, shots: 0, grenades: 0, pickups: 0 };
  const maxTicks = rounds * 170 * 100;
  for (let i = 0; i < maxTicks && r.round <= rounds; i++) {
    mgr.update(TICK_DT);
    g.tick();
    for (const e of g.takeEvents()) {
      if (e.type === 'kill') {
        stats.kills++;
        if (e.headshot) stats.headshots++;
      } else if (e.type === 'planted') stats.plants++;
      else if (e.type === 'shot') stats.shots++;
      else if (e.type === 'grenade') stats.grenades++;
      else if (e.type === 'pickup') stats.pickups++;
      else if (e.type === 'roundEnd') {
        stats.rounds.push(`${e.winner}:${e.reason}`);
        if (e.reason === 'defuse') stats.defuses++;
        if (e.reason === 'bomb') stats.explosions++;
      }
    }
    if (r.phase === 'live') {
      for (const p of g.players) {
        if (!p.alive) continue;
        stats.aliveTicks++;
        if (p.move.velocity.length2d() < 5) stats.stuckTicks++;
      }
    }
  }
  return stats;
}

test.each(['de_dust2', 'de_cache', 'de_mirage', 'de_inferno'])('bots play full rounds on %s', (name) => {
  const st = simulate(name, 6);
  if (process.env.BOTSIM) throw new Error(JSON.stringify(st));
  expect(st.rounds.length).toBeGreaterThanOrEqual(5);
  // Rounds should mostly end in fights or the bomb, not by the clock with everyone lost.
  expect(st.rounds.filter((r) => r.endsWith(':time')).length).toBeLessThanOrEqual(2);
  expect(st.kills).toBeGreaterThan(20);
  expect(st.plants).toBeGreaterThan(0);
  // Bots move: CTs hold still, but the T side should be walking most of the time.
  expect(st.stuckTicks / st.aliveTicks).toBeLessThan(0.7);
}, 120000);

test('fy_iceworld: bots pick up floor guns and fight it out', () => {
  const st = simulate('fy_iceworld', 4);
  if (process.env.BOTSIM) throw new Error(JSON.stringify(st));
  expect(st.rounds.length).toBeGreaterThanOrEqual(3);
  expect(st.rounds.every((r) => r.endsWith(':elimination') || r.endsWith(':time'))).toBe(true);
  expect(st.pickups).toBeGreaterThan(10);
}, 120000);
