import { expect, test } from 'vitest';
import { emptyCmd } from '../src/game/usercmd';
import type { ServerMsg, Snapshot } from '../src/net/protocol';
import { decodeEvent } from '../src/net/protocol';
import { Room, type Client } from '../src/server/room';
import { BombDefusal } from '../src/game/rules';

function fakeClient() {
  const inbox: ServerMsg[] = [];
  const client: Client = { send: (m) => inbox.push(JSON.parse(JSON.stringify(m))) };
  const lastSnap = (): Snapshot | undefined => [...inbox].reverse().find((m) => m.t === 'snap')?.s as Snapshot | undefined;
  return { client, inbox, lastSnap };
}

test('two humans join, replace bots, move, and see each other', () => {
  const room = new Room({ map: 'de_dust2', mode: 'defuse', difficulty: 'normal' });
  expect(room.game.players).toHaveLength(10);
  const a = fakeClient();
  const b = fakeClient();
  room.connect(a.client);
  room.connect(b.client);
  room.receive(a.client, { t: 'hello', name: 'alice', team: 'T', model: 1 });
  room.receive(b.client, { t: 'hello', name: 'bob', team: 'CT', model: 2 });
  // Still ten: each human took a bot's slot.
  expect(room.game.players).toHaveLength(10);
  const welcome = a.inbox.find((m) => m.t === 'welcome');
  expect(welcome && welcome.t === 'welcome' && welcome.info.map).toBe('de_dust2');
  const aliceId = welcome && welcome.t === 'welcome' ? welcome.id : -1;

  // Freeze time then walk forward for a second, one command per tick.
  let seq = 0;
  const start = room.game.players.find((p) => p.id === aliceId)!.origin.clone();
  for (let i = 0; i < 700; i++) {
    const cmd = { ...emptyCmd(), forward: 1, yaw: 0 };
    room.receive(a.client, { t: 'cmd', seq: ++seq, cmd });
    room.tick();
  }
  const snap = b.lastSnap()!;
  const alice = snap.players.find((p) => p.id === aliceId)!;
  expect(alice.name).toBe('alice');
  expect(Math.hypot(alice.pos[0] - start.x, alice.pos[2] - start.z)).toBeGreaterThan(100);
  expect(alice.ack).toBeGreaterThan(600);
  expect(snap.rules?.phase).toBe('live');
});

test('events carry player ids and decode back to players', () => {
  const room = new Room({ map: 'aim_arena', mode: 'dm', difficulty: 'normal' });
  const a = fakeClient();
  room.connect(a.client);
  room.receive(a.client, { t: 'hello', name: 'alice', team: 'CT', model: 0 });
  for (let i = 0; i < 30; i++) room.tick();
  const ev = a.inbox.filter((m) => m.t === 'events').flatMap((m) => (m.t === 'events' ? m.e : []));
  expect(ev.length).toBeGreaterThan(0);
  const decoded = decodeEvent(ev[0], (id) => room.game.players.find((p) => p.id === id)) as { type: string };
  expect(typeof decoded.type).toBe('string');
});

test('leaving puts a bot back', () => {
  const room = new Room({ map: 'de_dust2', mode: 'defuse', difficulty: 'normal' });
  const a = fakeClient();
  room.connect(a.client);
  room.receive(a.client, { t: 'hello', name: 'alice', team: 'T', model: 0 });
  room.disconnect(a.client);
  expect(room.game.players.filter((p) => p.team === 'T')).toHaveLength(5);
  expect(room.game.players.every((p) => p.isBot)).toBe(true);
});

test('server accepts a Silencer launch through player commands and snapshots it to a late joiner', () => {
  const room = new Room({ map: 'de_dust2', mode: 'defuse', difficulty: 'normal', teamSize: 1 });
  const a = fakeClient();
  room.connect(a.client);
  room.receive(a.client, { t: 'hello', name: 'Operator', team: 'CT', model: 0 });
  room.receive(a.client, { t: 'buy', item: 'silencer' });
  const owner = room.game.players.find((p) => !p.isBot)!;
  expect(owner.weapon?.def.id).toBe('silencer');
  room.bots.update = () => {};
  for (let i = 0; i < 600; i++) room.tick();
  room.receive(a.client, { t: 'cmd', seq: 1, cmd: { ...emptyCmd(), attack2: true } });
  room.tick();
  room.receive(a.client, { t: 'cmd', seq: 2, cmd: emptyCmd() });
  for (let i = 0; i < 30; i++) room.tick();
  room.receive(a.client, { t: 'cmd', seq: 3, cmd: { ...emptyCmd(), attack: true } });
  room.tick();
  const late = fakeClient();
  room.connect(late.client);
  for (let i = 0; i < 4; i++) room.tick();
  expect(late.lastSnap()?.nuke?.site).toBe('B');
  expect(late.lastSnap()?.nuke?.owner).toBe(owner.id);
  expect(a.lastSnap()?.players.find((p) => p.id === owner.id)?.weapons.primary?.clip).toBe(0);
  for (let i = 0; i < 1000; i++) room.tick();
  expect(late.lastSnap()?.nuke?.exploded).toBe(true);
  expect(late.lastSnap()?.players.every((p) => !p.alive)).toBe(true);
  expect((room.mode as BombDefusal).lastReason).toBe('nuke');
  const events = a.inbox.flatMap((m) => m.t === 'events' ? m.e : []) as { type: string }[];
  expect(events.filter((e) => e.type === 'nukeLaunch')).toHaveLength(1);
  expect(events.filter((e) => e.type === 'nukeImpact')).toHaveLength(1);
});

test('a deathmatch late join spawns immediately after a nuke and restores the map', () => {
  const room = new Room({ map: 'aim_arena', mode: 'dm', difficulty: 'normal', teamSize: 1 });
  room.bots.update = () => {};
  const owner = room.game.players[0];
  room.game.equip(owner, 'silencer');
  expect(room.game.nukes.launch(owner)).toBe(true);
  room.game.time = room.game.nukes.strike!.impactAt;
  room.tick();
  expect(room.game.players.every((p) => !p.alive)).toBe(true);
  const late = fakeClient();
  room.connect(late.client);
  room.receive(late.client, { t: 'hello', name: 'Late joiner', team: 'CT', model: 0 });
  expect(room.game.players.find((p) => !p.isBot)?.alive).toBe(true);
  expect(room.game.nukes.strike).toBeNull();
  for (let i = 0; i < 4; i++) room.tick();
  expect(late.lastSnap()?.nuke).toBeNull();
});
