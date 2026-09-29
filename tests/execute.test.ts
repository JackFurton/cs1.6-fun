import { expect, test } from 'vitest';
import { BotManager } from '../src/bots/manager';
import { Game, TICK_DT } from '../src/game/game';
import { BombDefusal } from '../src/game/rules';
import { MAPS } from '../src/maps';

test.each(['de_dust2', 'de_inferno'])('Ts on %s smoke and flash their execute without blinding themselves', (name) => {
  let smokes = 0;
  let calls = 0;
  let selfBlind = 0;
  for (const seed of [131, 262, 393]) {
    let s = seed;
    const g = new Game(MAPS[name]());
    g.rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 5; i++) g.addPlayer(`t${i}`, 'T', true);
    for (let i = 0; i < 5; i++) g.addPlayer(`ct${i}`, 'CT', true);
    const r = new BombDefusal(g);
    g.rules = r;
    r.start();
    for (const p of g.players) {
      g.equip(p, p.team === 'T' ? 'ak47' : 'm4a1');
      if (p.team === 'T') for (const n of ['smokegrenade', 'flashbang', 'hegrenade'] as const) g.equip(p, n);
    }
    const mgr = new BotManager(g, r, 'normal');
    const seen = new Map<unknown, number>();
    for (let i = 0; i < 12000 && r.round === 1; i++) {
      mgr.update(TICK_DT);
      const popping = g.grenades.live.filter((n) => n.id === 'flashbang' && n.detonateAt <= g.time + 0.011).map((n) => n.thrower.team);
      g.tick();
      for (const e of g.takeEvents()) {
        if (e.type === 'grenade' && e.id === 'smokegrenade' && e.player.team === 'T') smokes++;
        if (e.type === 'radio' && /Smokes out/.test(e.text)) calls++;
      }
      for (const p of g.players) {
        if (p.flashStart === (seen.get(p) ?? -1)) continue;
        seen.set(p, p.flashStart);
        if (p.team === 'T' && p.flashUntil > g.time + 1 && popping.length === 1 && popping[0] === 'T') selfBlind++;
      }
    }
  }
  expect(calls).toBeGreaterThanOrEqual(1);
  expect(smokes).toBeGreaterThanOrEqual(1);
  expect(selfBlind).toBeLessThanOrEqual(3);
}, 60000);
