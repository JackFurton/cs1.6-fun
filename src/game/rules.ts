import { Vec3 } from '../engine/vec';
import { inZone, type Team } from '../maps/types';
import type { Game } from './game';
import type { BuyItem, GameMode } from './mode';
import type { Player } from './player';
import { WEAPONS } from './weapons';

export const ECON = {
  start: 800,
  max: 16000,
  kill: 300,
  winElimination: 3250,
  winTime: 3250,
  winBomb: 3500,
  winDefuse: 3500,
  lossBase: 1400,
  lossStep: 500,
  lossMax: 3400,
  plantedLossBonus: 800,
  plant: 300,
};

export interface MatchConfig {
  freezeTime: number;
  buyTime: number;
  roundTime: number;
  c4Timer: number;
  /** First to this many rounds wins the match. */
  winLimit: number;
  /** Swap sides after this many rounds (0 = never). */
  halftime: number;
}

export const DEFAULT_MATCH: MatchConfig = {
  freezeTime: 5,
  buyTime: 30,
  roundTime: 115,
  c4Timer: 35,
  winLimit: 16,
  halftime: 15,
};

export const PLANT_TIME = 3;
export const DEFUSE_TIME = 10;
export const DEFUSE_TIME_KIT = 5;
const BOMB_RADIUS = 1000;
const BOMB_DAMAGE = 500;
const ROUND_END_DELAY = 5;

export type Phase = 'freeze' | 'live' | 'over' | 'matchover';
export type RoundEnd = 'elimination' | 'time' | 'bomb' | 'defuse';

export interface Bomb {
  pos: Vec3;
  plantedAt: number;
  explodeAt: number;
  site: string;
  defuser: Player | null;
  defuseEnd: number;
  exploded: boolean;
  defused: boolean;
}

export class BombDefusal implements GameMode {
  phase: Phase = 'freeze';
  round = 0;
  score: Record<Team, number> = { T: 0, CT: 0 };
  lossStreak: Record<Team, number> = { T: 0, CT: 0 };
  phaseEnd = 0;
  roundStart = 0;
  bomb: Bomb | null = null;
  planter: Player | null = null;
  plantEnd = 0;
  lastWinner: Team | null = null;
  lastReason: RoundEnd | null = null;
  private nextBeep = 0;

  constructor(
    private g: Game,
    readonly cfg: MatchConfig = DEFAULT_MATCH,
  ) {}

  start(): void {
    this.round = 0;
    this.score = { T: 0, CT: 0 };
    this.lossStreak = { T: 0, CT: 0 };
    for (const p of this.g.players) {
      p.money = ECON.start;
      p.kills = p.deaths = 0;
      p.weapons = {};
      p.resetLoadout();
      p.armor = 0;
      p.helmet = false;
    }
    this.newRound();
  }

  get timeLeft(): number {
    if (this.phase === 'freeze') return this.cfg.roundTime;
    if (this.bomb && !this.bomb.exploded && !this.bomb.defused) return Math.max(0, this.bomb.explodeAt - this.g.time);
    return Math.max(0, this.phaseEnd - this.g.time);
  }

  canBuy(p: Player): boolean {
    if (!p.alive) return false;
    if (this.phase !== 'freeze' && !(this.phase === 'live' && this.g.time < this.roundStart + this.cfg.buyTime)) return false;
    return this.g.map.buyzones[p.team].some((z) => inZone(z, p.origin));
  }

  canMove(p: Player): boolean {
    if (this.phase === 'freeze') return false;
    if (this.planter === p || this.bomb?.defuser === p) return false;
    return true;
  }

  newRound(): void {
    const g = this.g;
    this.round++;
    if (this.cfg.halftime && this.round === this.cfg.halftime + 1) this.swapSides();
    this.bomb = null;
    this.planter = null;
    g.dropped.length = 0;
    const idx: Record<Team, number> = { T: 0, CT: 0 };
    for (const p of g.players) {
      const survived = p.alive && p.weapons.knife;
      if (!survived) {
        p.weapons = {};
        p.grenades = {};
        p.armor = 0;
        p.helmet = false;
        p.defuser = false;
        p.resetLoadout();
      }
      delete p.weapons.c4;
      g.spawn(p, idx[p.team]++);
      for (const w of Object.values(p.weapons)) {
        if (w.def.clip > 0) w.clip = w.def.clip;
      }
    }
    const ts = g.players.filter((p) => p.team === 'T');
    if (ts.length) {
      // Prefer giving the bomb to a bot so the human isn't forced to carry it every round.
      const pool = ts.some((p) => p.isBot) && ts.length > 1 ? ts.filter((p) => p.isBot) : ts;
      pool[Math.floor(g.rand() * pool.length)].give('c4');
    }
    this.phase = 'freeze';
    this.phaseEnd = g.time + this.cfg.freezeTime;
    g.emit({ type: 'round', phase: 'freeze', round: this.round });
  }

  private swapSides(): void {
    for (const p of this.g.players) {
      p.team = p.team === 'T' ? 'CT' : 'T';
      p.weapons = {};
      p.grenades = {};
      p.armor = 0;
      p.helmet = false;
      p.defuser = false;
      p.money = ECON.start;
      p.alive = false;
    }
    this.score = { T: this.score.CT, CT: this.score.T };
    this.lossStreak = { T: 0, CT: 0 };
    this.g.emit({ type: 'message', text: 'Halftime: teams switched sides', color: '#ffd24a' });
  }

  onKill(killer: Player | null, victim: Player): void {
    if (killer && killer !== victim && killer.team !== victim.team) this.addMoney(killer, ECON.kill);
    if (victim === this.planter) this.planter = null;
    if (this.bomb?.defuser === victim) this.bomb.defuser = null;
  }

  /** Whoever has the bomb in their inventory right now. */
  get carrier(): Player | null {
    return this.g.players.find((p) => p.alive && p.weapons.c4) ?? null;
  }

  /** Where the bomb is if nobody is carrying it and it isn't planted. */
  get looseC4(): Vec3 | null {
    return this.g.dropped.find((d) => d.state.def.id === 'c4')?.pos ?? null;
  }

  private addMoney(p: Player, amount: number): void {
    p.money = Math.max(0, Math.min(ECON.max, p.money + amount));
  }

  tick(): void {
    const g = this.g;
    switch (this.phase) {
      case 'freeze':
        if (g.time >= this.phaseEnd) {
          this.phase = 'live';
          this.roundStart = g.time;
          this.phaseEnd = g.time + this.cfg.roundTime;
          g.emit({ type: 'round', phase: 'live', round: this.round });
        }
        break;
      case 'live':
        this.updateC4();
        this.checkWin();
        break;
      case 'over':
        if (g.time >= this.phaseEnd) {
          if (this.score.T >= this.cfg.winLimit || this.score.CT >= this.cfg.winLimit) {
            this.phase = 'matchover';
            this.phaseEnd = g.time + 10;
            g.emit({ type: 'round', phase: 'matchover', round: this.round });
          } else {
            this.newRound();
          }
        } else {
          this.updateC4();
        }
        break;
      case 'matchover':
        if (g.time >= this.phaseEnd) this.start();
        break;
    }
  }

  private updateC4(): void {
    const g = this.g;
    // Planting: carrier holds attack with the bomb out, on the ground, inside a site.
    const c = this.carrier;
    if (c && c.alive && !this.bomb && this.phase === 'live') {
      const site = this.siteAt(c.origin);
      const wants = c.active === 'c4' && c.cmd.attack && c.move.onGround && site;
      if (wants) {
        if (this.planter !== c) {
          this.planter = c;
          this.plantEnd = g.time + PLANT_TIME;
          g.emit({ type: 'sound', name: 'plant_start', pos: c.origin.clone() });
        } else if (g.time >= this.plantEnd) {
          this.plant(c, site);
        }
      } else if (this.planter === c) {
        this.planter = null;
      }
    }

    const b = this.bomb;
    if (!b || b.exploded || b.defused) return;

    if (g.time >= this.nextBeep) {
      const left = b.explodeAt - g.time;
      g.emit({ type: 'sound', name: 'c4_beep', pos: b.pos });
      this.nextBeep = g.time + Math.max(0.12, Math.min(1.4, left / 25));
    }

    // Defusing: a CT holding use near the bomb.
    if (b.defuser) {
      const d = b.defuser;
      if (!d.alive || !d.cmd.use || d.origin.distanceTo(b.pos) > 72) {
        b.defuser = null;
      } else if (g.time >= b.defuseEnd) {
        b.defused = true;
        b.defuser = null;
        this.endRound('CT', 'defuse');
        return;
      }
    } else if (this.phase === 'live') {
      for (const p of g.players) {
        if (!p.alive || p.team !== 'CT' || !p.cmd.use) continue;
        if (p.origin.distanceTo(b.pos) <= 72) {
          b.defuser = p;
          b.defuseEnd = g.time + (p.defuser ? DEFUSE_TIME_KIT : DEFUSE_TIME);
          g.emit({ type: 'sound', name: p.defuser ? 'defuse_kit' : 'defuse', pos: b.pos });
          break;
        }
      }
    }

    if (g.time >= b.explodeAt) this.explode(b);
  }

  siteAt(pos: Vec3): string | null {
    for (const s of this.g.map.bombsites) if (inZone(s, pos)) return s.name;
    return null;
  }

  private plant(p: Player, site: string): void {
    const g = this.g;
    this.planter = null;
    delete p.weapons.c4;
    p.active = p.weapons.primary ? 'primary' : p.weapons.secondary ? 'secondary' : 'knife';
    p.deployedAt = g.time;
    p.nextAttack = g.time + 0.5;
    this.bomb = {
      pos: p.origin.clone(),
      plantedAt: g.time,
      explodeAt: g.time + this.cfg.c4Timer,
      site,
      defuser: null,
      defuseEnd: 0,
      exploded: false,
      defused: false,
    };
    this.nextBeep = g.time;
    this.addMoney(p, ECON.plant);
    g.emit({ type: 'planted', player: p, site });
  }

  private explode(b: Bomb): void {
    const g = this.g;
    b.exploded = true;
    g.emit({ type: 'explosion', pos: b.pos.clone(), big: true });
    for (const p of g.players) {
      if (!p.alive) continue;
      const d = p.origin.distanceTo(b.pos);
      if (d > BOMB_RADIUS) continue;
      // 1.6 falloff: full damage at the bomb, fading linearly; armor soaks half.
      let dmg = BOMB_DAMAGE * (1 - d / BOMB_RADIUS);
      if (p.armor > 0) dmg *= 0.5;
      g.damage(p, null, dmg, null, 'c4', new Vec3(0, 1, 0), false);
    }
    if (this.phase === 'live') this.endRound('T', 'bomb');
  }

  private checkWin(): void {
    const g = this.g;
    const alive = (t: Team) => g.players.some((p) => p.team === t && p.alive);
    const has = (t: Team) => g.players.some((p) => p.team === t);
    if (has('CT') && !alive('CT')) return this.endRound('T', 'elimination');
    if (has('T') && !alive('T') && !this.bomb) return this.endRound('CT', 'elimination');
    if (!this.bomb && g.time >= this.phaseEnd) return this.endRound('CT', 'time');
  }

  endRound(winner: Team, reason: RoundEnd): void {
    const g = this.g;
    if (this.phase !== 'live') return;
    const loser: Team = winner === 'T' ? 'CT' : 'T';
    this.phase = 'over';
    this.phaseEnd = g.time + ROUND_END_DELAY;
    this.score[winner]++;
    this.lastWinner = winner;
    this.lastReason = reason;
    this.lossStreak[winner] = 0;
    const lossBonus = Math.min(ECON.lossMax, ECON.lossBase + ECON.lossStep * this.lossStreak[loser]);
    this.lossStreak[loser]++;
    const winMoney = reason === 'bomb' ? ECON.winBomb : reason === 'defuse' ? ECON.winDefuse : reason === 'time' ? ECON.winTime : ECON.winElimination;
    for (const p of g.players) {
      if (p.team === winner) this.addMoney(p, winMoney);
      else if (reason === 'time' && p.team === 'T' && p.alive) {
        // 1.6: Terrorists who hide out the clock get nothing.
      } else this.addMoney(p, lossBonus + (p.team === 'T' && this.bomb ? ECON.plantedLossBonus : 0));
    }
    g.emit({ type: 'roundEnd', winner, reason });
  }

  /** Buy an item; returns an error string or null on success. */
  buy(p: Player, item: BuyItem): string | null {
    if (!this.canBuy(p)) return 'You can only buy in the buy zone during buy time';
    const g = this.g;
    switch (item) {
      case 'vest':
        if (p.armor >= 100) return 'You already have Kevlar';
        return this.pay(p, 650, () => (p.armor = 100));
      case 'vesthelm': {
        if (p.armor >= 100 && p.helmet) return 'You already have Kevlar and a helmet';
        const cost = p.armor >= 100 ? 350 : 1000;
        return this.pay(p, cost, () => {
          p.armor = 100;
          p.helmet = true;
        });
      }
      case 'defuser':
        if (p.team !== 'CT') return 'Only Counter-Terrorists can buy a defuse kit';
        if (p.defuser) return 'You already have a defuse kit';
        return this.pay(p, 200, () => (p.defuser = true));
      case 'primammo':
      case 'secammo': {
        const w = p.weapons[item === 'primammo' ? 'primary' : 'secondary'];
        if (!w || w.reserve >= w.def.reserve) return 'You cannot carry any more ammo';
        return this.pay(p, item === 'primammo' ? 60 : 20, () => (w.reserve = w.def.reserve));
      }
    }
    const def = WEAPONS[item];
    if (def.team && def.team !== p.team) return 'Your team cannot buy that';
    if (def.slot === 'grenade') {
      const max = item === 'flashbang' ? 2 : 1;
      if ((p.grenades[item] ?? 0) >= max) return 'You cannot carry any more';
      return this.pay(p, def.price, () => g.equip(p, item));
    }
    if (p.weapons[def.slot]?.def.id === item) return 'You already have that weapon';
    return this.pay(p, def.price, () => g.equip(p, item));
  }

  private pay(p: Player, cost: number, fn: () => unknown): string | null {
    if (p.money < cost) return 'You have insufficient funds!';
    p.money -= cost;
    fn();
    return null;
  }
}
