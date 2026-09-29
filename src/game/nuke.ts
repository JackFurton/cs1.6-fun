import { Vec3 } from '../engine/vec';
import type { Team } from '../maps/types';
import type { Game } from './game';
import type { Player } from './player';

export const NUKE_FLIGHT_TIME = 10;
export const NUKE_EFFECT_TIME = 10;
export const NUKE_WAVE_SPEED = 1800;

export interface NuclearStrike {
  pos: Vec3;
  site: string;
  owner: number;
  team: Team;
  launchedAt: number;
  impactAt: number;
  exploded: boolean;
}

/** A committed launch survives its operator and holds the round open until impact. */
export class NukeSystem {
  strike: NuclearStrike | null = null;

  constructor(private g: Game) {}

  target(p: Player): { pos: Vec3; site: string } {
    const sites = this.g.map.bombsites;
    const index = (p.weapon?.targetSite ?? 0) % Math.max(1, sites.length);
    const site = sites[index];
    const spawns = [...this.g.map.spawns.T, ...this.g.map.spawns.CT];
    const center = site ? new Vec3((site.min.x + site.max.x) / 2, site.max.y, (site.min.z + site.max.z) / 2)
      : spawns.reduce((v, s) => v.add(s.pos), new Vec3()).scale(1 / Math.max(1, spawns.length));
    // Place the impact on the site's roof or floor, including maps with different elevations.
    const top = new Vec3(center.x, Math.max(center.y, 0) + 2048, center.z);
    const bottom = new Vec3(center.x, center.y - 2048, center.z);
    const tr = this.g.world.trace(top, bottom, undefined, undefined, undefined, (b) => !b.clip);
    return { pos: tr.fraction < 1 ? tr.endpos.clone() : center, site: site?.name ?? 'Arena' };
  }

  launch(p: Player): boolean {
    const w = p.weapon;
    if (!p.alive || w?.def.id !== 'silencer' || w.clip <= 0 || this.strike) return false;
    if (this.g.rules.canAttack && !this.g.rules.canAttack(p)) return false;
    if (this.g.rules.canLaunchNuke && !this.g.rules.canLaunchNuke()) return false;
    const target = this.target(p);
    this.strike = { ...target, owner: p.id, team: p.team, launchedAt: this.g.time, impactAt: this.g.time + NUKE_FLIGHT_TIME, exploded: false };
    w.clip--;
    w.lastFire = this.g.time;
    p.nextAttack = this.g.time + w.def.cycle;
    this.g.emit({ type: 'nukeLaunch', pos: target.pos.clone(), site: target.site, impactAt: this.strike.impactAt });
    return true;
  }

  tick(): void {
    const s = this.strike;
    if (!s) return;
    const g = this.g;
    if (!s.exploded && g.time + 1e-7 >= s.impactAt) {
      s.exploded = true;
      g.emit({ type: 'nukeImpact', pos: s.pos.clone() });
      const owner = g.players.find((p) => p.id === s.owner) ?? null;
      for (const p of g.players) {
        if (!p.alive) continue;
        // Cover, armor, distance, and team cannot save anyone from a strategic strike.
        g.damage(p, p.team === s.team ? null : owner, p.health, null, 'silencer', new Vec3(0, 1, 0), false);
      }
      g.dropped.length = 0;
      g.grenades.live.length = 0;
      g.grenades.smokes.length = 0;
      g.rules.onNuke?.(s.team, owner);
    }
    if (s.exploded && g.time + 1e-7 >= s.impactAt + NUKE_EFFECT_TIME) this.strike = null;
  }
}
