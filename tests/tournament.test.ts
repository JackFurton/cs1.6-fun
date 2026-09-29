import { expect, test } from 'vitest';
import { Game } from '../src/game/game';
import { AimTournament } from '../src/game/tournament';
import { emptyCmd } from '../src/game/usercmd';
import { aimArena } from '../src/maps/aim_arena';
import { snapshot, type ClientMsg, type ServerMsg } from '../src/net/protocol';
import { Room, type Client } from '../src/server/room';

function arena() {
  const g = new Game(aimArena());
  for (let i = 0; i < 16; i++) g.addPlayer(`Player ${i}`, i % 2 ? 'T' : 'CT', i > 1);
  const t = new AimTournament(g);
  g.rules = t;
  t.start();
  return { g, t };
}
function advance(g: Game, t: AimTournament) {
  g.time = t.state.phaseEnd + 0.01;
  t.tick();
}
function win(g: Game, t: AimTournament, side: 0 | 1) {
  if (t.state.phase === 'freeze') advance(g, t);
  for (const p of t.members(t.current!.duos[1 - side]!)) g.kill(p, null, 'world', false, false);
  t.tick();
}
function join(room: Room, name: string) {
  const inbox: ServerMsg[] = [];
  const client: Client = { send: (m) => inbox.push(structuredClone(m)) };
  room.connect(client);
  room.receive(client, { t: 'hello', name, team: 'auto', model: 0 });
  const welcome = inbox.find((m) => m.t === 'welcome');
  const player = welcome?.t === 'welcome' ? room.game.players.find((p) => p.id === welcome.id) : undefined;
  return { client, inbox, player };
}

test('16 slots form eight duos; partners can share a duo and nobody displaces a human', () => {
  const { g, t } = arena();
  expect(t.state.duos).toHaveLength(8);
  expect(t.state.duos.every((d) => d.members.length === 2)).toBe(true);
  expect(g.players.some((p) => p.alive)).toBe(false);
  const [a, b] = g.players;
  expect(t.chooseDuo(a, 5)).toBeNull();
  expect(t.chooseDuo(b, 5)).toBeNull();
  expect(t.members(5)).toEqual([a, b]);
  const displaced = g.players[2];
  expect(t.chooseDuo(displaced, 5)).toMatch(/two players/);
  expect(t.chooseDuo(a, NaN)).toMatch(/Choose/);
  expect(new Set(t.state.duos.flatMap((d) => d.members)).size).toBe(16);
});

test('everyone must ready up; changing partners cancels the countdown', () => {
  const { g, t } = arena();
  const [a, b] = g.players;
  t.setReady(a, true);
  g.time = 100;
  t.tick();
  expect(t.state.phase).toBe('lobby');
  t.setReady(b, true);
  expect(t.state.phaseEnd).toBe(108);
  t.chooseDuo(a, 2);
  expect(t.state.phaseEnd).toBe(0);
  expect(t.state.ready).toEqual([]);
  t.setReady(a, true);
  t.setReady(b, true);
  advance(g, t);
  expect(t.state.phase).toBe('freeze');
  expect(t.chooseDuo(a, 0)).toMatch(/locked/);
});

test('only four spawn with equal gear; freeze prevents firing and spectators never respawn', () => {
  const { g, t } = arena();
  t.begin();
  const active = g.players.filter((p) => p.alive);
  expect(active).toHaveLength(4);
  expect(active.filter((p) => p.team === 'T')).toHaveLength(2);
  expect(active.filter((p) => p.team === 'CT')).toHaveLength(2);
  for (const p of active) {
    expect(p.weapons.primary?.def.id).toBe('ak47');
    expect(p.weapons.secondary?.def.id).toBe('deagle');
    expect(p.armor).toBe(100);
    expect(p.weapons.c4).toBeUndefined();
    p.cmd = { ...emptyCmd(), forward: 1, attack: true };
  }
  for (let i = 0; i < 100; i++) g.tick();
  expect(active.every((p) => p.weapons.primary!.clip === 30)).toBe(true);
  advance(g, t);
  const dead = active[0];
  g.kill(dead, null, 'world', false, false);
  for (let i = 0; i < 250; i++) g.tick();
  expect(dead.alive).toBe(false);
  expect(g.players.slice(4).some((p) => p.alive)).toBe(false);
  expect(t.canLaunchNuke()).toBe(false);
  expect(t.buy(active[1], 'silencer')).toMatch(/AK-47/);
});

test('best of three needs two wins, swaps sides, and feeds winners into semifinals', () => {
  const { g, t } = arena();
  t.begin();
  const originalSide = t.members(0)[0].team;
  win(g, t, 0);
  expect(t.current!.score).toEqual([1, 0]);
  expect(t.current!.winner).toBeNull();
  advance(g, t);
  expect(t.members(0)[0].team).not.toBe(originalSide);
  win(g, t, 1);
  expect(t.current!.score).toEqual([1, 1]);
  advance(g, t);
  win(g, t, 0);
  expect(t.current!.score).toEqual([2, 1]);
  expect(t.current!.winner).toBe(0);
  expect(t.state.matches[4].duos).toEqual([0, null]);
  advance(g, t);
  expect(t.state.current).toBe(1);
  expect(g.players.filter((p) => p.alive).map((p) => t.duoFor(p)!.id)).toEqual([2, 2, 3, 3]);
});

test('all seven matches finish with one champion; a rematch preserves partners', () => {
  const { g, t } = arena();
  t.chooseDuo(g.players[0], 6);
  const roster = structuredClone(t.state.duos);
  t.begin();
  for (let match = 0; match < 7; match++) {
    expect(t.state.current).toBe(match);
    win(g, t, 0);
    advance(g, t);
    win(g, t, 0);
    if (match < 6) advance(g, t);
  }
  expect(t.state.phase).toBe('complete');
  expect(t.state.champion).toBe(0);
  expect(t.state.matches.map((m) => m.winner)).toEqual([0, 2, 4, 6, 0, 4, 0]);
  const snap = snapshot(g, new Map());
  expect(snap.tournament?.champion).toBe(0);
  t.start();
  expect(t.state.duos).toEqual(roster);
  expect(t.state.phase).toBe('lobby');
  expect(snap.tournament?.phase).toBe('complete');
  expect(g.players.some((p) => p.alive)).toBe(false);
});

test('simultaneous elimination and equal timeouts replay without points; health breaks a timeout tie', () => {
  const { g, t } = arena();
  t.begin();
  advance(g, t);
  for (const p of g.players.filter((p) => p.alive)) g.kill(p, null, 'world', false, false);
  t.tick();
  expect(t.current!.score).toEqual([0, 0]);
  expect(t.state.result).toMatch(/Draw/);
  advance(g, t);
  advance(g, t);
  advance(g, t);
  expect(t.state.result).toMatch(/Draw/);
  advance(g, t);
  advance(g, t);
  t.members(1)[0].health = 50;
  advance(g, t);
  expect(t.current!.score).toEqual([1, 0]);
});

test('network friends select the same duo, ready through their own connections, and receive the bracket', () => {
  const room = new Room({ mode: 'tournament', map: 'aim_arena', difficulty: 'normal' });
  const t = room.mode as AimTournament;
  const a = join(room, 'Alice');
  const b = join(room, 'Bob');
  for (const c of [a, b]) room.receive(c.client, { t: 'tournament', action: 'duo', duo: 0 });
  expect(t.duoFor(a.player!)?.id).toBe(t.duoFor(b.player!)?.id);
  expect(room.game.players).toHaveLength(16);
  room.receive(a.client, { t: 'tournament', action: 'ready', ready: true, playerId: b.player!.id } as ClientMsg);
  expect(t.state.ready).toEqual([a.player!.id]);
  room.receive(b.client, { t: 'tournament', action: 'ready', ready: true });
  room.game.time = t.state.phaseEnd + 0.01;
  for (let i = 0; i < 4; i++) room.tick();
  const snap = [...a.inbox].reverse().find((m) => m.t === 'snap');
  expect(snap?.t === 'snap' && snap.s.tournament?.phase).toBe('freeze');
  expect(a.player!.alive && b.player!.alive).toBe(true);
  expect(a.player!.team).toBe(b.player!.team);
  room.receive(a.client, { t: 'team', team: 'CT', model: 1 });
  expect(room.game.players).toHaveLength(16);
  expect(t.duoFor(a.player!)?.id).toBe(0);
  const late = join(room, 'Late');
  expect(late.inbox.find((m) => m.t === 'full')).toBeDefined();
  expect(room.game.players).toHaveLength(16);
});

test('disconnect keeps the duo full but the replacement waits for the next round', () => {
  const room = new Room({ mode: 'tournament', map: 'aim_arena', difficulty: 'normal' });
  const t = room.mode as AimTournament;
  const a = join(room, 'Alice');
  const duo = t.duoFor(a.player!)!.id;
  t.begin();
  advance(room.game, t);
  room.disconnect(a.client);
  expect(room.game.players).toHaveLength(16);
  expect(t.members(duo)).toHaveLength(2);
  expect(t.members(duo).filter((p) => p.alive)).toHaveLength(1);
  const replacement = t.members(duo).find((p) => !p.alive)!;
  for (let i = 0; i < 5; i++) t.tick();
  expect(replacement.alive).toBe(false);
  win(room.game, t, 0);
  advance(room.game, t);
  expect(replacement.alive).toBe(true);
});

test('all sixteen human seats fill and a seventeenth cannot overflow the bracket', () => {
  const room = new Room({ mode: 'tournament', map: 'aim_arena', difficulty: 'normal' });
  for (let i = 0; i < 16; i++) expect(join(room, `Human ${i}`).player).toBeDefined();
  const extra = join(room, 'Extra');
  expect(extra.player).toBeUndefined();
  expect(extra.inbox.find((m) => m.t === 'full')).toBeDefined();
  expect(room.game.players).toHaveLength(16);
  expect(room.game.players.every((p) => !p.isBot)).toBe(true);
});

test('bots actually fight and complete the bracket without host intervention', () => {
  const room = new Room({ mode: 'tournament', map: 'aim_arena', difficulty: 'hard' });
  const t = room.mode as AimTournament;
  let seed = 91;
  room.game.rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  t.begin();
  for (let i = 0; i < 220000 && t.state.phase !== 'complete'; i++) room.tick();
  expect(t.state.phase).toBe('complete');
  expect(t.state.matches.every((m) => m.winner !== null)).toBe(true);
  expect(room.game.players.reduce((n, p) => n + p.kills, 0)).toBeGreaterThan(14);
}, 30000);
