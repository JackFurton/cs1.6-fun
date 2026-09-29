import type { Team } from '../maps/types';
import type { Game } from './game';
import type { BuyItem, GameMode } from './mode';
import type { Player } from './player';
import { emptyCmd } from './usercmd';

export type TournamentPhase = 'lobby' | 'freeze' | 'live' | 'roundEnd' | 'matchEnd' | 'complete';
export interface Duo {
  id: number;
  members: number[];
}
export interface TournamentMatch {
  id: number;
  stage: 'Quarterfinal' | 'Semifinal' | 'Final';
  duos: [number | null, number | null];
  score: [number, number];
  winner: number | null;
}
export interface TournamentState {
  phase: TournamentPhase;
  phaseEnd: number;
  duos: Duo[];
  ready: number[];
  matches: TournamentMatch[];
  current: number;
  roundSerial: number;
  champion: number | null;
  result: string;
}

export const DUO_COUNT = 8;
export const TOURNAMENT_PLAYERS = DUO_COUNT * 2;
const FREEZE = 5;
const ROUND_TIME = 90;
const READY_COUNTDOWN = 8;

/** Eight fixed duos, one arena, seven first-to-two matches. Only the current four spawn. */
export class AimTournament implements GameMode {
  state: TournamentState = {
    phase: 'lobby', phaseEnd: 0, duos: [], ready: [], matches: [], current: 0,
    roundSerial: 0, champion: null, result: '',
  };

  constructor(private g: Game) {}

  get current(): TournamentMatch | undefined { return this.state.matches[this.state.current]; }
  get round(): number { return this.current ? this.current.score[0] + this.current.score[1] + 1 : 1; }

  start(): void {
    // A rematch preserves partners. A fresh mode assigns the initial sixteen slots.
    let duos = this.state.duos;
    const ids = new Set(duos.flatMap((d) => d.members));
    if (duos.length !== DUO_COUNT || ids.size !== TOURNAMENT_PLAYERS || this.g.players.some((p) => !ids.has(p.id))) {
      duos = Array.from({ length: DUO_COUNT }, (_, id) => ({ id, members: this.g.players.slice(id * 2, id * 2 + 2).map((p) => p.id) }));
    }
    this.state = {
      phase: 'lobby', phaseEnd: 0, duos, ready: [], current: 0,
      roundSerial: 0, champion: null, result: '',
      matches: Array.from({ length: 7 }, (_, id) => ({
        id, stage: id < 4 ? 'Quarterfinal' : id < 6 ? 'Semifinal' : 'Final',
        duos: id < 4 ? [id * 2, id * 2 + 1] : [null, null], score: [0, 0], winner: null,
      })),
    };
    this.clearArena();
    for (const p of this.g.players) {
      p.kills = p.deaths = p.assists = p.headshots = p.mvps = p.damageDealt = 0;
    }
  }

  duoFor(p: Player): Duo | undefined { return this.state.duos.find((d) => d.members.includes(p.id)); }
  members(duo: number): Player[] {
    const ids = this.state.duos[duo]?.members ?? [];
    return ids.flatMap((id) => this.g.players.find((p) => p.id === id) ?? []);
  }

  /** Swap a player with a bot; a full human duo cannot be displaced. */
  chooseDuo(p: Player, id: number): string | null {
    if (this.state.phase !== 'lobby') return 'Teams are locked until the tournament ends.';
    if (!Number.isInteger(id) || id < 0 || id >= DUO_COUNT) return 'Choose a duo from 1 to 8.';
    const from = this.duoFor(p);
    if (!from) return 'Join the tournament first.';
    if (from.id === id) return null;
    const to = this.state.duos[id];
    const bot = this.members(id).find((m) => m.isBot);
    if (!bot) return 'That duo already has two players.';
    from.members[from.members.indexOf(p.id)] = bot.id;
    to.members[to.members.indexOf(bot.id)] = p.id;
    this.resetReady();
    return null;
  }

  replacePlayer(old: Player, replacement: Player): void {
    const duo = this.duoFor(old);
    if (duo) duo.members[duo.members.indexOf(old.id)] = replacement.id;
    replacement.alive = false; // A disconnect never grants an extra life mid-round.
    if (this.state.phase === 'lobby') this.resetReady();
  }

  private resetReady(): void {
    this.state.ready = [];
    this.state.phaseEnd = 0;
  }

  setReady(p: Player, ready: boolean): string | null {
    if (this.state.phase !== 'lobby' || !this.duoFor(p) || p.isBot) return 'Ready up in the tournament lobby.';
    this.state.ready = this.state.ready.filter((id) => id !== p.id);
    if (ready) this.state.ready.push(p.id);
    if (this.allReady()) {
      if (!this.state.phaseEnd) this.state.phaseEnd = this.g.time + READY_COUNTDOWN;
    } else this.state.phaseEnd = 0;
    return null;
  }

  private allReady(): boolean {
    const humans = this.g.players.filter((p) => !p.isBot && this.duoFor(p));
    return humans.length > 0 && humans.every((p) => this.state.ready.includes(p.id));
  }

  begin(): string | null {
    if (this.state.phase !== 'lobby') return 'A tournament is already running.';
    if (this.g.players.length !== TOURNAMENT_PLAYERS || this.state.duos.some((d) => this.members(d.id).length !== 2)) return 'The tournament needs eight duos.';
    this.startRound();
    return null;
  }

  canBuy(): boolean { return false; }
  buy(_p: Player, _item: BuyItem): string { return 'Aim tournament: everyone gets an AK-47, Desert Eagle and armor.'; }
  canDrop(): boolean { return false; }
  canLaunchNuke(): boolean { return false; }
  canMove(p: Player): boolean { return this.state.phase === 'live' && this.isActive(p); }
  canAttack(p: Player): boolean { return this.canMove(p); }

  private isActive(p: Player): boolean {
    const id = this.duoFor(p)?.id;
    return id !== undefined && !!this.current?.duos.includes(id);
  }

  private clearArena(): void {
    for (const p of this.g.players) {
      p.alive = false;
      p.noclip = false;
      p.cmd = emptyCmd();
      p.move.velocity.set(0, 0, 0);
    }
    this.g.dropped.length = 0;
    this.g.grenades.live.length = this.g.grenades.smokes.length = 0;
    this.g.nukes.strike = null;
  }

  private startRound(): void {
    this.clearArena();
    const match = this.current!;
    const swap = (match.score[0] + match.score[1]) % 2 !== 0;
    match.duos.forEach((duo, side) => {
      const team: Team = (side === 0) !== swap ? 'T' : 'CT';
      this.members(duo!).forEach((p, index) => {
        p.team = team;
        p.resetLoadout();
        p.give('ak47');
        p.give('deagle');
        p.active = 'primary';
        p.money = 0;
        p.armor = 100;
        p.helmet = true;
        p.defuser = false;
        this.g.spawn(p, index);
        this.g.emit({ type: 'respawn', player: p });
      });
    });
    this.state.phase = 'freeze';
    this.state.phaseEnd = this.g.time + FREEZE;
    this.state.roundSerial++;
    this.state.result = '';
    this.g.emit({ type: 'round', phase: 'freeze', round: this.round });
  }

  /** Resolve after the whole simulation tick, so simultaneous deaths can draw. */
  tick(): void {
    const s = this.state;
    if (s.phase === 'lobby') {
      if (s.phaseEnd && this.allReady() && this.g.time >= s.phaseEnd) this.begin();
      return;
    }
    if (s.phase === 'complete') return;
    if (s.phase === 'live') {
      const alive = this.current!.duos.map((id) => this.members(id!).filter((p) => p.alive));
      if (!alive[0].length || !alive[1].length) {
        this.finishRound(alive[0].length ? 0 : alive[1].length ? 1 : null, 'elimination');
      } else if (this.g.time >= s.phaseEnd) {
        const strength = alive.map((ps) => ps.length * 1000 + ps.reduce((n, p) => n + p.health, 0));
        this.finishRound(strength[0] === strength[1] ? null : strength[0] > strength[1] ? 0 : 1, 'time');
      }
      return;
    }
    if (this.g.time < s.phaseEnd) return;
    if (s.phase === 'freeze') {
      s.phase = 'live';
      s.phaseEnd = this.g.time + ROUND_TIME;
      this.g.emit({ type: 'round', phase: 'live', round: this.round });
    } else if (s.phase === 'roundEnd') this.startRound();
    else if (s.phase === 'matchEnd') {
      s.current++;
      this.startRound();
    }
  }

  private finishRound(side: 0 | 1 | null, reason: 'elimination' | 'time'): void {
    const s = this.state;
    const match = this.current!;
    s.phase = 'roundEnd';
    s.phaseEnd = this.g.time + 4;
    if (side === null) {
      s.result = 'Draw — replaying the round';
    } else {
      match.score[side]++;
      const winner = match.duos[side]!;
      s.result = `Duo ${winner + 1} wins the round${reason === 'time' ? ' on survivors / health' : ''}`;
      if (match.score[side] === 2) {
        match.winner = winner;
        s.phase = 'matchEnd';
        s.phaseEnd = this.g.time + 7;
        s.result = `Duo ${winner + 1} wins ${match.score[0]}–${match.score[1]}`;
        if (match.id < 6) {
          const next = match.id < 4 ? 4 + Math.floor(match.id / 2) : 6;
          s.matches[next].duos[match.id % 2] = winner;
        } else {
          s.champion = winner;
          s.phase = 'complete';
          s.phaseEnd = 0;
          s.result = `Duo ${winner + 1} are the champions!`;
        }
      }
    }
    this.g.emit({ type: 'message', text: s.result, color: '#ffd24a' });
  }
}
