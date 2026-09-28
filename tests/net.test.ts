import { expect, test } from 'vitest';
import { emptyCmd } from '../src/game/usercmd';
import type { ServerMsg, Snapshot } from '../src/net/protocol';
import { decodeEvent } from '../src/net/protocol';
import { Room, type Client } from '../src/server/room';

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
