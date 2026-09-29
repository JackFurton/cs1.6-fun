import { boxBrush, setBoxBrush, type Brush } from '../engine/brush';
import { Vec3 } from '../engine/vec';
import type { GameEvent } from '../game/events';
import { DroppedWeapon, TICK_DT, type Game } from '../game/game';
import { Grenade } from '../game/grenades';
import type { GameMode } from '../game/mode';
import { Player, WeaponState } from '../game/player';
import { BombDefusal } from '../game/rules';
import type { UserCmd } from '../game/usercmd';
import { WEAPONS, type WeaponId } from '../game/weapons';
import type { Team } from '../maps/types';
import { DEFAULT_PORT, applyPlayerState, applyRules, decodeEvent, type ClientMsg, type ServerInfo, type ServerMsg, type Snapshot } from '../net/protocol';

/** How far behind the newest snapshot other players are drawn, so there are always two to blend. */
const INTERP = 0.1;

/** Resolve what the user typed into a WebSocket URL; blank means the server this page came from. */
export function serverUrl(addr: string): string {
  addr = addr.trim();
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (!addr) return `${protocol}//${location.host}/`;
  const hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(addr);
  const url = new URL(hasScheme ? addr : `${protocol}//${addr}`);
  if (url.protocol === 'http:') url.protocol = 'ws:';
  if (url.protocol === 'https:') url.protocol = 'wss:';
  if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Enter an HTTP, HTTPS, or WebSocket server address');
  }
  if (!hasScheme && !url.port) url.port = String(DEFAULT_PORT);
  url.search = '';
  url.hash = '';
  return url.href;
}

/** Connect and wait for the server to say which map it's running. */
export function connect(url: string): Promise<{ ws: WebSocket; info: ServerInfo }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => fail(`Connection timed out after 10 seconds: ${url}`), 10000);
    const cleanup = () => {
      clearTimeout(timer);
      ws.onerror = ws.onclose = ws.onmessage = null;
    };
    const fail = (message: string) => {
      cleanup();
      if (ws.readyState < WebSocket.CLOSING) ws.close();
      reject(new Error(message));
    };
    ws.onerror = ws.onclose = () => fail(`Couldn't reach the game server at ${url}`);
    ws.onmessage = (e) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(e.data)) as ServerMsg;
      } catch {
        fail('The address responded, but did not send a valid game message');
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'info') {
        if (!msg.info || typeof msg.info.map !== 'string' || !['defuse', 'dm'].includes(msg.info.mode)) {
          fail('The address did not send valid game server information');
          return;
        }
        cleanup();
        resolve({ ws, info: msg.info });
      }
    };
  });
}

/**
 * The client half of a network game: sends commands, predicts our own movement and replays
 * unacknowledged commands on each snapshot, and moves everyone else between snapshots.
 */
export class NetClient {
  localId: number | null = null;
  private seq = 0;
  private history: { seq: number; cmd: UserCmd }[] = [];
  private snaps: Snapshot[] = [];
  private byId = new Map<number, Player>();
  private boxes = new Map<Player, Brush>();
  /** Server time estimate, advanced locally between snapshots. */
  private serverTime = 0;
  /** Raw events, decoded when taken so they resolve against the latest player list. */
  private events: unknown[] = [];
  onWelcome: (local: Player) => void = () => {};
  onBuyResult: (err: string | null) => void = () => {};
  onChat: (from: Player | undefined, text: string) => void = () => {};
  onClose: () => void = () => {};
  latency = 0;

  constructor(
    private ws: WebSocket,
    readonly info: ServerInfo,
    private game: Game,
    private mode: GameMode,
  ) {
    ws.onmessage = (e) => this.receive(JSON.parse(String(e.data)) as ServerMsg);
    ws.onclose = () => this.onClose();
  }

  send(msg: ClientMsg): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  join(name: string, team: Team | 'auto', model: number): void {
    this.send({ t: 'hello', name, team, model });
  }

  player(id: number): Player | undefined {
    return this.byId.get(id);
  }

  get local(): Player | undefined {
    return this.localId === null ? undefined : this.byId.get(this.localId);
  }

  private receive(msg: ServerMsg): void {
    switch (msg.t) {
      case 'welcome':
        this.localId = msg.id;
        this.history = [];
        // The player object appears with the next snapshot.
        break;
      case 'snap':
        this.onSnapshot(msg.s);
        break;
      case 'events':
        this.events.push(...msg.e);
        break;
      case 'buyResult':
        this.onBuyResult(msg.err);
        break;
      case 'chat':
        this.onChat(this.byId.get(msg.from), msg.text);
        break;
    }
  }

  takeEvents(): GameEvent[] {
    const out: GameEvent[] = [];
    const keep: unknown[] = [];
    for (const raw of this.events) {
      // Events can arrive before the snapshot that introduces a player (they're sent every tick,
      // snapshots 30 times a second). Hold those back briefly rather than handing out nulls.
      let missing = false;
      const ev = decodeEvent(raw, (id) => {
        const p = this.byId.get(id);
        if (!p) missing = true;
        return p;
      }) as GameEvent & { age?: number };
      if (!missing) out.push(ev);
      else {
        const r = raw as { __age?: number };
        r.__age = (r.__age ?? 0) + 1;
        // A player who left before we ever saw them: give up after a few frames.
        if (r.__age < 30) keep.push(raw);
      }
    }
    this.events = keep;
    return out;
  }

  private onSnapshot(s: Snapshot): void {
    this.snaps.push(s);
    if (this.snaps.length > 30) this.snaps.shift();
    // Snap forward if we drifted; otherwise nudge, so HUD timers don't stutter.
    const d = s.time - this.serverTime;
    this.serverTime = Math.abs(d) > 0.25 ? s.time : this.serverTime + d * 0.1;

    // Players: create new ones, drop ones that left, update state.
    const seen = new Set<number>();
    for (const ps of s.players) {
      seen.add(ps.id);
      let p = this.byId.get(ps.id);
      const introduced = !p;
      if (!p) {
        p = new Player(ps.id, ps.name, ps.team, ps.bot);
        p.move.origin.set(...ps.pos);
        p.yaw = ps.yaw;
        p.pitch = ps.pitch;
        p.prevOrigin.copy(p.move.origin);
        this.byId.set(ps.id, p);
        this.game.players.push(p);
        this.boxes.set(p, boxBrush(new Vec3(), new Vec3(), 'player'));
      }
      applyPlayerState(p, ps);
      if (ps.id === this.localId) this.reconcile(p, ps);
      else {
        p.punchPitch = ps.punch[0];
        p.punchYaw = ps.punch[1];
      }
      if (introduced && ps.id === this.localId) this.onWelcome(p);
    }
    for (const [id, p] of this.byId) {
      if (seen.has(id)) continue;
      this.byId.delete(id);
      this.game.players.splice(this.game.players.indexOf(p), 1);
    }

    if (s.rules && this.mode instanceof BombDefusal) applyRules(this.mode, s.rules, (id) => this.byId.get(id));

    this.game.nukes.strike = s.nuke ? { ...s.nuke, pos: new Vec3(...s.nuke.pos) } : null;

    // World objects are just drawn, so rebuild them from the snapshot.
    this.game.dropped.length = 0;
    for (const d of s.dropped) {
      const w = new DroppedWeapon(new WeaponState(WEAPONS[d.id]), new Vec3(...d.pos), Infinity);
      w.yaw = d.yaw;
      this.game.dropped.push(w);
    }
    this.game.grenades.live.length = 0;
    for (const n of s.nades) {
      const g = new Grenade(n.id as 'hegrenade', new Vec3(...n.pos), this.local ?? new Player(-1, '', 'T', false), 0);
      g.stopped = n.stopped;
      this.game.grenades.live.push(g);
    }
    this.game.grenades.smokes.length = 0;
    for (const sm of s.smokes) this.game.grenades.smokes.push({ pos: new Vec3(...sm.pos), start: sm.start, until: sm.until });
  }

  /** Take the server's word for where we are, then replay what it hasn't seen yet. */
  private reconcile(p: Player, ps: Snapshot['players'][number]): void {
    const m = p.move;
    m.origin.set(...ps.pos);
    m.velocity.set(...ps.vel);
    m.onGround = ps.ground;
    m.ducked = ps.ducked;
    m.duckAmount = ps.duck;
    m.jumpPenalty = ps.jumpPen;
    m.oldJump = ps.oldJump;
    p.punchPitch = ps.punch[0];
    p.punchYaw = ps.punch[1];
    this.history = this.history.filter((h) => h.seq > ps.ack);
    if (!p.alive) return;
    const before = p.prevOrigin.clone();
    for (const h of this.history) this.predict(p, h.cmd);
    // Keep interpolation smooth across the correction.
    p.prevOrigin.copy(before);
  }

  private predict(p: Player, cmd: UserCmd): void {
    this.game.mover.others = this.solidsExcept(p);
    this.game.mover.move(p.move, cmd, p.maxSpeed(), TICK_DT);
  }

  private solidsExcept(self: Player): Brush[] {
    const out: Brush[] = [];
    for (const p of this.game.players) {
      if (p === self || !p.alive) continue;
      const b = this.boxes.get(p);
      if (!b) continue;
      setBoxBrush(b, p.origin.clone().add(p.move.mins), p.origin.clone().add(p.move.maxs));
      out.push(b);
    }
    return out;
  }

  /** One client tick: send our command, predict ourselves, and move everyone else. */
  tick(cmd: UserCmd): void {
    this.serverTime += TICK_DT;
    this.game.time = this.serverTime;
    for (const p of this.game.players) {
      p.prevOrigin.copy(p.origin);
      p.prevViewHeight = p.move.viewHeight;
    }
    const local = this.local;
    if (local) {
      const c = { ...cmd };
      this.seq++;
      this.send({ t: 'cmd', seq: this.seq, cmd: c });
      // One-shot requests go out once, then clear so they aren't repeated.
      cmd.slot = null;
      cmd.drop = false;
      this.history.push({ seq: this.seq, cmd: c });
      if (this.history.length > 200) this.history.shift();
      local.yaw = c.yaw;
      local.pitch = c.pitch;
      if (local.alive) this.predict(local, c);
    }
    this.interpolate();
  }

  /** Place everyone except us at `serverTime - INTERP`, blending the two snapshots around it. */
  private interpolate(): void {
    const t = this.serverTime - INTERP;
    let a: Snapshot | undefined;
    let b: Snapshot | undefined;
    for (let i = this.snaps.length - 1; i >= 0; i--) {
      if (this.snaps[i].time <= t) {
        a = this.snaps[i];
        b = this.snaps[i + 1] ?? a;
        break;
      }
    }
    if (!a) a = b = this.snaps[0];
    if (!a || !b) return;
    const f = b.time > a.time ? Math.min(1, Math.max(0, (t - a.time) / (b.time - a.time))) : 1;
    const bById = new Map(b.players.map((p) => [p.id, p]));
    for (const pa of a.players) {
      if (pa.id === this.localId) continue;
      const p = this.byId.get(pa.id);
      const pb = bById.get(pa.id) ?? pa;
      if (!p) continue;
      const lerp = (x: number, y: number) => x + (y - x) * f;
      p.move.origin.set(lerp(pa.pos[0], pb.pos[0]), lerp(pa.pos[1], pb.pos[1]), lerp(pa.pos[2], pb.pos[2]));
      p.move.velocity.set(...pb.vel);
      let dy = pb.yaw - pa.yaw;
      if (dy > 180) dy -= 360;
      if (dy < -180) dy += 360;
      p.yaw = pa.yaw + dy * f;
      p.pitch = lerp(pa.pitch, pb.pitch);
      p.move.onGround = pb.ground;
      p.move.ducked = pb.ducked;
      p.move.duckAmount = lerp(pa.duck, pb.duck);
    }
  }
}

export type { WeaponId };
