import { expect, test } from 'vitest';
import { BotManager } from '../src/bots/manager';
import { Game, TICK_DT } from '../src/game/game';
import { BombDefusal } from '../src/game/rules';
import { MAPS } from '../src/maps';

function setup() {
  const g = new Game(MAPS.de_dust2());
  let s = 3;
  g.rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const me = g.addPlayer('me', 'T', false);
  for (let i = 0; i < 4; i++) g.addPlayer(`t${i}`, 'T', true);
  for (let i = 0; i < 5; i++) g.addPlayer(`ct${i}`, 'CT', true);
  const r = new BombDefusal(g);
  g.rules = r;
  r.start();
  const mgr = new BotManager(g, r, 'normal');
  const run = (secs: number) => {
    for (let i = 0; i < secs / TICK_DT; i++) {
      mgr.update(TICK_DT);
      g.tick();
    }
  };
  return { g, me, mgr, run };
}

test('follow me: the two nearest bots come along', () => {
  const { me, mgr, run } = setup();
  run(5.5);
  mgr.command(me, 'followme');
  // Walk the human off toward mid; followers should trail within a couple of hundred units.
  me.cmd.forward = 1;
  me.cmd.yaw = 0;
  run(6);
  const followers = mgr.bots.filter((b) => b.task.kind === 'follow');
  expect(followers).toHaveLength(2);
  for (const b of followers) expect(b.p.origin.distanceTo(me.origin)).toBeLessThan(450);
});

test('go B sends the whole team to B and they answer on the radio', () => {
  const { g, me, mgr, run } = setup();
  run(5.5);
  mgr.command(me, 'gob');
  const replies: string[] = [];
  for (let i = 0; i < 200; i++) {
    run(0.01);
    for (const e of g.takeEvents()) if (e.type === 'radio') replies.push(e.text);
  }
  expect(replies.some((t) => t.startsWith('Going B'))).toBe(true);
  const b = mgr['sites'].find((s: { zone: { name: string } }) => s.zone.name === 'B')!;
  expect(mgr.targetSite).toBe(b);
  const mates = mgr.bots.filter((x) => x.p.team === 'T' && x.p.alive);
  expect(mates.every((x) => x.task.kind === 'go')).toBe(true);
});
