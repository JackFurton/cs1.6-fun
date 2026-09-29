import type { Game } from './game';
import type { BuyItem, GameMode } from './mode';
import type { Player } from './player';
import { WEAPONS } from './weapons';

const RESPAWN = 2;

/** Free-for-all-by-team deathmatch: instant respawns, buy anything anywhere, no objective. */
export class Deathmatch implements GameMode {
  private respawnAt = new Map<Player, number>();

  constructor(private g: Game) {}

  start(): void {
    this.respawnAt.clear();
    this.g.nukes.strike = null;
    this.g.players.forEach((p, i) => {
      p.money = 16000;
      this.g.spawn(p, i);
    });
  }

  canBuy(p: Player): boolean {
    return p.alive;
  }

  canDrop(): boolean {
    return true;
  }

  onKill(_killer: Player | null, victim: Player): void {
    this.respawnAt.set(victim, this.g.time + RESPAWN);
  }

  tick(): void {
    for (const [p, t] of this.respawnAt) {
      if (!this.g.players.includes(p)) {
        this.respawnAt.delete(p);
        continue;
      }
      if (this.g.time < t) continue;
      this.respawnAt.delete(p);
      const spawns = this.g.map.spawns[p.team];
      this.g.spawn(p, Math.floor(this.g.rand() * spawns.length));
      p.armor = 100;
      p.helmet = true;
      p.money = 16000;
      this.g.emit({ type: 'respawn', player: p });
    }
  }

  buy(p: Player, item: BuyItem): string | null {
    if (!p.alive) return 'You are dead';
    if (item === 'vest' || item === 'vesthelm') {
      p.armor = 100;
      p.helmet = item === 'vesthelm';
      return null;
    }
    if (item === 'defuser' || item === 'primammo' || item === 'secammo') return null;
    const def = WEAPONS[item];
    if (!def) return 'That weapon is unavailable';
    if (def.slot === 'grenade') return 'No grenades in deathmatch';
    this.g.equip(p, item);
    return null;
  }
}
