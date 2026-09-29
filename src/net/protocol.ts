import type { Difficulty } from '../bots/skill';
import { Vec3 } from '../engine/vec';
import type { DroppedWeapon, Game } from '../game/game';
import type { BuyItem } from '../game/mode';
import { Player, WeaponState } from '../game/player';
import type { RadioCommand } from '../game/radio';
import { BombDefusal } from '../game/rules';
import { AimTournament, type TournamentState } from '../game/tournament';
import type { UserCmd } from '../game/usercmd';
import { WEAPONS, type Slot, type WeaponId } from '../game/weapons';
import type { Team } from '../maps/types';
import type { NuclearStrike } from '../game/nuke';

export const DEFAULT_PORT = 27015;
export const SNAPSHOT_HZ = 30;

export interface ServerInfo {
  map: string;
  mode: 'defuse' | 'dm' | 'tournament';
  difficulty: Difficulty;
}

// ---------------------------------------------------------------- messages

export type ClientMsg =
  | { t: 'hello'; name: string; team: Team | 'auto'; model: number }
  | { t: 'cmd'; seq: number; cmd: UserCmd }
  | { t: 'buy'; item: BuyItem }
  | { t: 'radio'; cmd: RadioCommand }
  | { t: 'chat'; text: string }
  | { t: 'tournament'; action: 'duo'; duo: number }
  | { t: 'tournament'; action: 'ready'; ready: boolean }
  | { t: 'tournament'; action: 'again' }
  | { t: 'team'; team: Team | 'auto'; model: number };

export type ServerMsg =
  | { t: 'info'; info: ServerInfo }
  | { t: 'welcome'; id: number; info: ServerInfo }
  | { t: 'snap'; s: Snapshot }
  | { t: 'events'; e: unknown[] }
  | { t: 'buyResult'; err: string | null }
  | { t: 'chat'; from: number; text: string }
  | { t: 'full'; reason: string };

// ---------------------------------------------------------------- snapshots

export interface WeaponSnap {
  id: WeaponId;
  clip: number;
  reserve: number;
  zoom: number;
  resumeZoom: number;
  reloading: boolean;
  reloadEnd: number;
  silenced: boolean;
  burst: boolean;
  shotsFired: number;
  lastFire: number;
  targetSite: number;
}

export interface PlayerSnap {
  id: number;
  name: string;
  team: Team;
  model: number;
  bot: boolean;
  alive: boolean;
  pos: [number, number, number];
  vel: [number, number, number];
  yaw: number;
  pitch: number;
  ground: boolean;
  ducked: boolean;
  duck: number;
  jumpPen: number;
  oldJump: boolean;
  health: number;
  armor: number;
  helmet: boolean;
  defuser: boolean;
  money: number;
  k: number;
  d: number;
  a: number;
  hs: number;
  mvp: number;
  dmg: number;
  active: Slot;
  weapons: Partial<Record<Slot, WeaponSnap>>;
  grenades: Partial<Record<WeaponId, number>>;
  punch: [number, number];
  nextAttack: number;
  deployedAt: number;
  flashUntil: number;
  flashStrength: number;
  velMod: number;
  /** Last command from this player the server has applied (for prediction replay). */
  ack: number;
}

export interface RulesSnap {
  phase: BombDefusal['phase'];
  round: number;
  score: Record<Team, number>;
  phaseEnd: number;
  roundStart: number;
  plantEnd: number;
  planter: number | null;
  bomb: { pos: [number, number, number]; explodeAt: number; site: string; defuser: number | null; defuseEnd: number; exploded: boolean; defused: boolean } | null;
  history: { winner: Team; reason: 'elimination' | 'time' | 'bomb' | 'defuse' | 'nuke'; mvp: number | null }[];
}

export interface Snapshot {
  time: number;
  players: PlayerSnap[];
  rules: RulesSnap | null;
  tournament: TournamentState | null;
  nuke: (Omit<NuclearStrike, 'pos'> & { pos: [number, number, number] }) | null;
  dropped: { id: WeaponId; pos: [number, number, number]; yaw: number }[];
  nades: { id: WeaponId; pos: [number, number, number]; stopped: boolean }[];
  smokes: { pos: [number, number, number]; start: number; until: number }[];
}

const v3 = (v: Vec3): [number, number, number] => [round(v.x), round(v.y), round(v.z)];
const round = (n: number) => Math.round(n * 100) / 100;

function weaponSnap(w: WeaponState): WeaponSnap {
  return { id: w.def.id, clip: w.clip, reserve: w.reserve, zoom: w.zoom, resumeZoom: w.resumeZoom, reloading: w.reloading, reloadEnd: w.reloadEnd, silenced: w.silenced, burst: w.burst, shotsFired: w.shotsFired, lastFire: w.lastFire, targetSite: w.targetSite };
}

export function snapshot(g: Game, acks: Map<Player, number>): Snapshot {
  const rules = g.rules instanceof BombDefusal ? g.rules : null;
  return {
    time: g.time,
    tournament: g.rules instanceof AimTournament ? structuredClone(g.rules.state) : null,
    nuke: g.nukes.strike ? { ...g.nukes.strike, pos: v3(g.nukes.strike.pos) } : null,
    players: g.players.map((p) => ({
      id: p.id,
      name: p.name,
      team: p.team,
      model: p.model,
      bot: p.isBot,
      alive: p.alive,
      pos: v3(p.origin),
      vel: v3(p.move.velocity),
      yaw: round(p.yaw),
      pitch: round(p.pitch),
      ground: p.move.onGround,
      ducked: p.move.ducked,
      duck: round(p.move.duckAmount),
      jumpPen: round(p.move.jumpPenalty),
      oldJump: p.move.oldJump,
      health: p.health,
      armor: p.armor,
      helmet: p.helmet,
      defuser: p.defuser,
      money: p.money,
      k: p.kills,
      d: p.deaths,
      a: p.assists,
      hs: p.headshots,
      mvp: p.mvps,
      dmg: p.damageDealt,
      active: p.active,
      weapons: Object.fromEntries(Object.entries(p.weapons).map(([s, w]) => [s, weaponSnap(w!)])),
      grenades: { ...p.grenades },
      punch: [round(p.punchPitch), round(p.punchYaw)],
      nextAttack: p.nextAttack,
      deployedAt: p.deployedAt,
      flashUntil: p.flashUntil,
      flashStrength: p.flashStrength,
      velMod: p.velocityModifier,
      ack: acks.get(p) ?? 0,
    })),
    rules: rules
      ? {
          phase: rules.phase,
          round: rules.round,
          score: { ...rules.score },
          phaseEnd: rules.phaseEnd,
          roundStart: rules.roundStart,
          plantEnd: rules.plantEnd,
          planter: rules.planter?.id ?? null,
          bomb: rules.bomb ? { pos: v3(rules.bomb.pos), explodeAt: rules.bomb.explodeAt, site: rules.bomb.site, defuser: rules.bomb.defuser?.id ?? null, defuseEnd: rules.bomb.defuseEnd, exploded: rules.bomb.exploded, defused: rules.bomb.defused } : null,
          history: rules.history.map((h) => ({ winner: h.winner, reason: h.reason, mvp: h.mvp?.id ?? null })),
        }
      : null,
    dropped: g.dropped.map((d) => ({ id: d.state.def.id, pos: v3(d.pos), yaw: Math.round(d.yaw) })),
    nades: g.grenades.live.map((n) => ({ id: n.id, pos: v3(n.pos), stopped: n.stopped })),
    smokes: g.grenades.smokes.map((s) => ({ pos: v3(s.pos), start: s.start, until: s.until })),
  };
}

/** Copy the parts of a snapshot that describe state (not motion) onto a client-side Player. */
export function applyPlayerState(p: Player, s: PlayerSnap): void {
  p.name = s.name;
  p.team = s.team;
  p.model = s.model;
  p.alive = s.alive;
  p.health = s.health;
  p.armor = s.armor;
  p.helmet = s.helmet;
  p.defuser = s.defuser;
  p.money = s.money;
  p.kills = s.k;
  p.deaths = s.d;
  p.assists = s.a;
  p.headshots = s.hs;
  p.mvps = s.mvp;
  p.damageDealt = s.dmg;
  p.grenades = { ...s.grenades };
  p.flashUntil = s.flashUntil;
  p.flashStrength = s.flashStrength;
  p.velocityModifier = s.velMod;
  p.deployedAt = s.deployedAt;
  p.nextAttack = s.nextAttack;
  // Reuse WeaponState objects so things keyed on them (viewmodel) don't churn.
  const next: Partial<Record<Slot, WeaponState>> = {};
  for (const [slot, ws] of Object.entries(s.weapons) as [Slot, WeaponSnap][]) {
    let w = p.weapons[slot];
    if (!w || w.def.id !== ws.id) w = new WeaponState(WEAPONS[ws.id]);
    w.clip = ws.clip;
    w.reserve = ws.reserve;
    w.zoom = ws.zoom;
    w.resumeZoom = ws.resumeZoom;
    w.reloading = ws.reloading;
    w.reloadEnd = ws.reloadEnd;
    w.silenced = ws.silenced;
    w.burst = ws.burst;
    w.shotsFired = ws.shotsFired;
    w.lastFire = ws.lastFire;
    w.targetSite = ws.targetSite;
    next[slot] = w;
  }
  p.weapons = next;
  p.active = s.active;
}

export function applyRules(r: BombDefusal, s: RulesSnap, byId: (id: number) => Player | undefined): void {
  r.phase = s.phase;
  r.round = s.round;
  r.score = { ...s.score };
  r.phaseEnd = s.phaseEnd;
  r.roundStart = s.roundStart;
  r.plantEnd = s.plantEnd;
  r.planter = s.planter === null ? null : (byId(s.planter) ?? null);
  r.bomb = s.bomb
    ? { pos: new Vec3(...s.bomb.pos), plantedAt: 0, explodeAt: s.bomb.explodeAt, site: s.bomb.site, defuser: s.bomb.defuser === null ? null : (byId(s.bomb.defuser) ?? null), defuseEnd: s.bomb.defuseEnd, exploded: s.bomb.exploded, defused: s.bomb.defused }
    : null;
  r.history = s.history.map((h) => ({ winner: h.winner, reason: h.reason, mvp: h.mvp === null ? null : (byId(h.mvp) ?? null) }));
}

// ---------------------------------------------------------------- events

/** GameEvents hold Player and Vec3 objects; send them as ids and arrays. */
export function encodeEvent(e: unknown): unknown {
  if (e instanceof Player) return { $p: e.id };
  if (e instanceof Vec3) return { $v: [round(e.x), round(e.y), round(e.z)] };
  if (Array.isArray(e)) return e.map(encodeEvent);
  if (e && typeof e === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(e)) out[k] = encodeEvent(v);
    return out;
  }
  return e;
}

export function decodeEvent(e: unknown, byId: (id: number) => Player | undefined): unknown {
  if (Array.isArray(e)) return e.map((x) => decodeEvent(x, byId));
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    if ('$p' in o) return byId(o.$p as number) ?? null;
    if ('$v' in o) return new Vec3(...(o.$v as [number, number, number]));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) out[k] = decodeEvent(v, byId);
    return out;
  }
  return e;
}

export type { DroppedWeapon };
