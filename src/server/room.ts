import { BotManager } from '../bots/manager';
import type { Difficulty } from '../bots/skill';
import { Deathmatch } from '../game/deathmatch';
import { Game, TICK_DT } from '../game/game';
import type { GameMode } from '../game/mode';
import type { Player } from '../game/player';
import { radioText } from '../game/radio';
import { BombDefusal } from '../game/rules';
import { AimTournament, TOURNAMENT_PLAYERS } from '../game/tournament';
import { emptyCmd, type UserCmd } from '../game/usercmd';
import { MAPS } from '../maps';
import type { Team } from '../maps/types';
import { SNAPSHOT_HZ, encodeEvent, snapshot, type ClientMsg, type ServerInfo, type ServerMsg } from '../net/protocol';

const BOT_NAMES = ['Gordon', 'Adrian', 'Barney', 'Otis', 'Kleiner', 'Eli', 'Alyx', 'Breen', 'Vance', 'Shephard', 'Magnusson', 'Grigori', 'Mossman', 'Calhoun', 'Freeman', 'Wallace', 'Cross', 'Laszlo'];
const TEAM_SIZE = 5;
/** Commands buffered per client; more than this means the client is running ahead and we drop the oldest. */
const MAX_QUEUE = 8;

export interface RoomOptions {
  map: string;
  mode: 'defuse' | 'dm' | 'tournament';
  difficulty: Difficulty;
  /** Keep teams topped up to this many with bots. */
  teamSize?: number;
}

export interface Client {
  send(msg: ServerMsg): void;
}

interface Human {
  client: Client;
  player: Player | null;
  queue: { seq: number; cmd: UserCmd }[];
  last: UserCmd;
}

/**
 * One match on a dedicated server: the authoritative Game, its rules and bots, and the humans
 * connected to it. The network layer (ws) and the clock live outside so tests can drive it directly.
 */
export class Room {
  readonly game: Game;
  readonly mode: GameMode;
  readonly bots: BotManager;
  readonly info: ServerInfo;
  private humans = new Map<Client, Human>();
  private acks = new Map<Player, number>();
  private snapAcc = 0;
  private names = [...BOT_NAMES].sort(() => Math.random() - 0.5);

  constructor(readonly opts: RoomOptions) {
    const map = (MAPS[opts.map] ?? MAPS.de_dust2)();
    this.game = new Game(map);
    this.info = { map: map.name, mode: opts.mode, difficulty: opts.difficulty };
    const size = opts.mode === 'tournament' ? TOURNAMENT_PLAYERS / 2 : opts.teamSize ?? TEAM_SIZE;
    for (const team of ['T', 'CT'] as const) for (let i = 0; i < size; i++) this.newBot(team, false);
    this.mode = opts.mode === 'tournament' ? new AimTournament(this.game) : opts.mode === 'dm' ? new Deathmatch(this.game) : new BombDefusal(this.game);
    this.game.rules = this.mode;
    this.mode.start();
    this.bots = new BotManager(this.game, this.mode, opts.difficulty);
  }

  private newBot(team: Team, register = true): Player {
    const p = this.game.addPlayer(this.names.pop() ?? `Bot${this.game.players.length}`, team, true);
    p.model = Math.floor(Math.random() * 4);
    if (register) {
      this.bots.addBot(p, this.opts.difficulty);
      this.placeLateJoiner(p);
    }
    return p;
  }

  /** Someone joining mid-round spawns now in deathmatch or freeze time, otherwise next round. */
  private placeLateJoiner(p: Player): void {
    if (this.mode instanceof AimTournament) {
      p.alive = false;
      return;
    }
    const d = this.mode instanceof BombDefusal ? this.mode : null;
    if (!d || d.phase === 'freeze') this.game.spawn(p, this.freeSpawn(p));
    else p.alive = false;
    if (this.mode instanceof Deathmatch) p.money = 16000;
    else p.money = 800;
  }

  /** A spawn point on the player's side that nobody is standing on. */
  private freeSpawn(p: Player): number {
    const spawns = this.game.map.spawns[p.team];
    for (let i = 0; i < spawns.length; i++) {
      const s = spawns[i].pos;
      if (!this.game.players.some((o) => o !== p && o.alive && Math.hypot(o.origin.x - s.x, o.origin.z - s.z) < 40)) return i;
    }
    return Math.floor(Math.random() * spawns.length);
  }

  connect(client: Client): void {
    this.humans.set(client, { client, player: null, queue: [], last: emptyCmd() });
    client.send({ t: 'info', info: this.info });
  }

  disconnect(client: Client): void {
    const h = this.humans.get(client);
    this.humans.delete(client);
    if (!h?.player) return;
    const team = h.player.team;
    this.game.emit({ type: 'message', text: `${h.player.name} left the game` });
    this.game.removePlayer(h.player);
    this.acks.delete(h.player);
    if (this.mode instanceof AimTournament) {
      this.mode.replacePlayer(h.player, this.newBot(team));
      return;
    }
    // Refill the empty slot with a bot.
    if (this.teamCount(team) < (this.opts.teamSize ?? TEAM_SIZE)) this.newBot(team);
  }

  private teamCount(team: Team): number {
    return this.game.players.filter((p) => p.team === team).length;
  }

  private join(h: Human, name: string, choice: Team | 'auto', model: number): void {
    if (this.mode instanceof AimTournament) {
      if (h.player) return;
      if (this.mode.state.phase !== 'lobby') {
        h.client.send({ t: 'full', reason: 'This tournament has started. Join after the host opens the next lobby.' });
        return;
      }
      const bot = this.game.players.find((p) => p.isBot);
      if (!bot) {
        h.client.send({ t: 'full', reason: 'All 16 tournament slots are taken.' });
        return;
      }
      this.bots.removeBot(bot);
      this.game.removePlayer(bot);
      const p = this.game.addPlayer(String(name).slice(0, 24) || 'Player', bot.team, false);
      p.model = Number.isInteger(model) && model >= 0 && model < 4 ? model : 0;
      this.mode.replacePlayer(bot, p);
      h.player = p;
      h.last = emptyCmd();
      h.queue.length = 0;
      h.client.send({ t: 'welcome', id: p.id, info: this.info });
      return;
    }
    const humansOn = (t: Team) => [...this.humans.values()].filter((x) => x.player?.team === t).length;
    const team: Team = choice === 'T' || choice === 'CT' ? choice : humansOn('T') <= humansOn('CT') ? 'T' : 'CT';
    if (h.player) {
      if (h.player.team === team) return;
      this.game.removePlayer(h.player);
      this.acks.delete(h.player);
      if (this.teamCount(h.player.team) < (this.opts.teamSize ?? TEAM_SIZE)) this.newBot(h.player.team);
    }
    // Take a bot's place so teams stay even.
    const bot = this.game.players.find((p) => p.isBot && p.team === team);
    if (bot) {
      this.bots.removeBot(bot);
      this.game.removePlayer(bot);
    }
    const p = this.game.addPlayer(name.slice(0, 24) || 'Player', team, false);
    p.model = model >= 0 && model < 4 ? model : Math.floor(Math.random() * 4);
    this.placeLateJoiner(p);
    h.player = p;
    h.last = { ...emptyCmd(), yaw: p.yaw, pitch: p.pitch };
    h.queue.length = 0;
    this.game.emit({ type: 'message', text: `${p.name} joined the ${team === 'T' ? 'Terrorists' : 'Counter-Terrorists'}` });
    h.client.send({ t: 'welcome', id: p.id, info: this.info });
  }

  receive(client: Client, msg: ClientMsg): void {
    const h = this.humans.get(client);
    if (!h) return;
    switch (msg.t) {
      case 'hello':
      case 'team':
        this.join(h, msg.t === 'hello' ? msg.name : (h.player?.name ?? 'Player'), msg.team, msg.model);
        break;
      case 'cmd':
        h.queue.push({ seq: msg.seq, cmd: msg.cmd });
        if (h.queue.length > MAX_QUEUE) h.queue.splice(0, h.queue.length - MAX_QUEUE);
        break;
      case 'buy':
        if (h.player) client.send({ t: 'buyResult', err: this.mode.buy(h.player, msg.item) });
        break;
      case 'tournament':
        if (this.mode instanceof AimTournament && h.player) {
          let err: string | null = null;
          if (msg.action === 'duo') err = this.mode.chooseDuo(h.player, msg.duo);
          else if (msg.action === 'ready' && typeof msg.ready === 'boolean') err = this.mode.setReady(h.player, msg.ready);
          else if (msg.action === 'again' && this.mode.state.phase === 'complete') this.mode.start();
          if (err) client.send({ t: 'buyResult', err });
        }
        break;
      case 'radio':
        if (h.player?.alive) {
          this.game.emit({ type: 'radio', player: h.player, text: radioText(msg.cmd) });
          this.bots.command(h.player, msg.cmd);
        }
        break;
      case 'chat':
        if (h.player) this.broadcast({ t: 'chat', from: h.player.id, text: String(msg.text).slice(0, 160) });
        break;
    }
  }

  /** Tournament administration is local to the hosting terminal. */
  hostCommand(line: string): string {
    const [command, argument] = line.trim().split(/\s+/);
    if (command === 'players') {
      const people = [...this.humans.values()].filter((h) => h.player);
      return people.map(({ player: p }) => `${p!.id}: ${p!.name} (${this.mode instanceof AimTournament ? `Duo ${(this.mode.duoFor(p!)?.id ?? -1) + 1}` : p!.team})`).join('\n') || 'No players have joined yet.';
    }
    if (command === 'tournament' && this.mode instanceof AimTournament) {
      if (argument === 'start') return this.mode.begin() ?? 'Tournament started: eight duos, best of three.';
      if (argument === 'reset') {
        this.mode.start();
        return 'Tournament lobby reopened. Duos kept; everyone can ready up again.';
      }
    }
    return this.mode instanceof AimTournament ? 'Host commands: players | tournament start | tournament reset' : 'Host commands: players';
  }

  private broadcast(msg: ServerMsg): void {
    for (const h of this.humans.values()) h.client.send(msg);
  }

  /** One 100Hz server tick. */
  tick(): void {
    for (const h of this.humans.values()) {
      const p = h.player;
      if (!p) continue;
      // One command per tick keeps the server in step with the client's prediction.
      const next = h.queue.shift();
      if (next) {
        h.last = next.cmd;
        this.acks.set(p, next.seq);
        p.cmd = next.cmd;
      } else {
        // Starved (packet late): repeat movement and aim, but never replay one-shot actions.
        p.cmd = { ...h.last, slot: null, drop: false };
      }
    }
    this.bots.update(TICK_DT);
    this.game.tick();
    const events = this.game.takeEvents();
    if (events.length) this.broadcast({ t: 'events', e: events.map(encodeEvent) });
    this.snapAcc += TICK_DT;
    if (this.snapAcc >= 1 / SNAPSHOT_HZ) {
      this.snapAcc = 0;
      this.broadcast({ t: 'snap', s: snapshot(this.game, this.acks) });
    }
  }

  get humanCount(): number {
    return this.humans.size;
  }
}
