import { Trace } from '../engine/trace';
import { Vec3, angleVectors } from '../engine/vec';
import type { Game } from './game';
import type { Player } from './player';
import type { WeaponId } from './weapons';

export type GrenadeId = 'hegrenade' | 'flashbang' | 'smokegrenade';

export const GRENADE_IDS: GrenadeId[] = ['hegrenade', 'flashbang', 'smokegrenade'];
export const GRENADE_MAX: Record<GrenadeId, number> = { hegrenade: 1, flashbang: 2, smokegrenade: 1 };

const FUSE = 1.5;
const HE_RADIUS = 350;
const HE_DAMAGE = 100;
const FLASH_RADIUS = 1500;
export const SMOKE_RADIUS = 150;
const SMOKE_TIME = 18;

const MINS = new Vec3(-2, -2, -2);
const MAXS = new Vec3(2, 2, 2);

export class Grenade {
  readonly vel = new Vec3();
  stopped = false;
  constructor(
    readonly id: GrenadeId,
    readonly pos: Vec3,
    readonly thrower: Player,
    readonly detonateAt: number,
  ) {}
}

export interface Smoke {
  pos: Vec3;
  start: number;
  until: number;
}

export function isGrenade(id: WeaponId): id is GrenadeId {
  return (GRENADE_IDS as string[]).includes(id);
}

/** Initial velocity for a throw, following CS 1.6's CGrenade::ShootTimed call in the grenade weapons. */
export function throwVelocity(yaw: number, pitch: number, playerVel: Vec3, out = new Vec3()): Vec3 {
  // 1.6 works in HL pitch (positive = down) and flattens the throw toward 10 degrees up.
  let hl = -pitch;
  if (hl < 0) hl = -10 + hl * ((90 - 10) / 90);
  else hl = -10 + hl * ((90 + 10) / 90);
  const speed = Math.min(750, (90 - hl) * 6);
  const f = new Vec3();
  angleVectors(yaw, -hl, f);
  return out.copy(f).scale(speed).add(playerVel);
}

export class GrenadeSystem {
  readonly live: Grenade[] = [];
  readonly smokes: Smoke[] = [];
  private tr = new Trace();

  constructor(private g: Game) {}

  throw(p: Player, id: GrenadeId): void {
    const g = this.g;
    const f = new Vec3();
    angleVectors(p.yaw + p.punchYaw, p.pitch + p.punchPitch, f);
    const eye = p.eye();
    const start = eye.clone().addScaled(f, 16);
    // Don't start inside a wall if the player is hugging one.
    g.world.trace(eye, start, MINS, MAXS, this.tr);
    const n = new Grenade(id, this.tr.endpos.clone(), p, g.time + FUSE);
    throwVelocity(p.yaw + p.punchYaw, p.pitch + p.punchPitch, p.move.velocity, n.vel);
    this.live.push(n);
    g.emit({ type: 'grenade', player: p, id });
  }

  update(dt: number): void {
    const g = this.g;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const n = this.live[i];
      if (!n.stopped) this.move(n, dt);
      // Smokes wait until they've mostly stopped rolling before popping.
      if (g.time >= n.detonateAt && (n.id !== 'smokegrenade' || n.stopped || n.vel.length() < 60 || g.time > n.detonateAt + 3)) {
        this.live.splice(i, 1);
        this.detonate(n);
      }
    }
    for (let i = this.smokes.length - 1; i >= 0; i--) if (g.time > this.smokes[i].until) this.smokes.splice(i, 1);
  }

  private move(n: Grenade, dt: number): void {
    const g = this.g;
    // 1.6 grenades use half gravity.
    n.vel.y -= 400 * dt;
    let left = dt;
    for (let bump = 0; bump < 3 && left > 0; bump++) {
      const to = n.pos.clone().addScaled(n.vel, left);
      g.world.trace(n.pos, to, MINS, MAXS, this.tr);
      n.pos.copy(this.tr.endpos);
      if (this.tr.fraction >= 1) break;
      left -= left * this.tr.fraction;
      const nrm = this.tr.normal;
      const vn = n.vel.dot(nrm);
      n.vel.addScaled(nrm, -vn * 1.45);
      if (nrm.y > 0.7) {
        n.vel.scale(0.55);
        if (n.vel.length() < 20) {
          n.vel.set(0, 0, 0);
          n.stopped = true;
        }
      } else {
        n.vel.scale(0.7);
      }
      if (Math.abs(vn) > 60) g.emit({ type: 'sound', name: 'bounce', pos: n.pos.clone() });
    }
  }

  private detonate(n: Grenade): void {
    const g = this.g;
    const at = n.pos.clone();
    const center = at.clone().add(new Vec3(0, 8, 0));
    switch (n.id) {
      case 'hegrenade':
        g.emit({ type: 'explosion', pos: at, big: false });
        for (const p of g.players) {
          if (!p.alive) continue;
          const body = p.origin.clone().add(new Vec3(0, 36, 0));
          const d = body.distanceTo(center);
          if (d > HE_RADIUS) continue;
          if (!g.world.visible(center, body) && !g.world.visible(center, p.eye())) continue;
          let dmg = HE_DAMAGE * (1 - d / HE_RADIUS);
          if (p.armor > 0) {
            const absorbed = dmg * 0.5;
            p.armor = Math.max(0, Math.round(p.armor - absorbed * 0.5));
            dmg -= absorbed;
          }
          g.damage(p, n.thrower, dmg, null, 'hegrenade', body.clone().sub(center), false);
        }
        break;
      case 'flashbang':
        g.emit({ type: 'flash', pos: at });
        for (const p of g.players) {
          if (!p.alive) continue;
          const eye = p.eye();
          const d = eye.distanceTo(center);
          if (d > FLASH_RADIUS || !g.world.visible(center, eye) || this.smokeBlocks(center, eye)) continue;
          const f = new Vec3();
          angleVectors(p.yaw, p.pitch, f);
          const to = center.clone().sub(eye);
          to.normalize();
          const facing = f.dot(to);
          // Looking at it: long blind. Side-on: half. Turned away: a short flash.
          const angle = facing > 0.5 ? 1 : facing > -0.3 ? 0.5 : 0.2;
          const dist = 1 - Math.pow(d / FLASH_RADIUS, 1.5);
          const dur = 5 * angle * dist;
          if (dur < 0.3) continue;
          const until = g.time + dur;
          if (until > p.flashUntil) {
            p.flashUntil = until;
            p.flashStrength = Math.min(1, angle * dist * 1.4);
            p.flashStart = g.time;
          }
        }
        break;
      case 'smokegrenade':
        this.smokes.push({ pos: center.add(new Vec3(0, 48, 0)), start: g.time, until: g.time + SMOKE_TIME });
        g.emit({ type: 'smoke', pos: at });
        break;
    }
  }

  /** Does the segment a-b pass through an active smoke cloud? */
  smokeBlocks(a: Vec3, b: Vec3): boolean {
    const now = this.g.time;
    for (const s of this.smokes) {
      // Smoke takes a second to bloom and thins out at the end.
      const age = now - s.start;
      if (age < 0.8 || now > s.until - 1.5) continue;
      const r = SMOKE_RADIUS * 0.9;
      const ab = b.clone().sub(a);
      const len2 = ab.dot(ab);
      const t = len2 > 0 ? Math.max(0, Math.min(1, s.pos.clone().sub(a).dot(ab) / len2)) : 0;
      const closest = a.clone().addScaled(ab, t);
      if (closest.distanceTo(s.pos) < r) return true;
    }
    return false;
  }
}

/**
 * Pitch (our convention, positive up) that lobs a grenade from `from` to land near `to`,
 * ignoring bounces. Picks the flattest arc that gets there; null if out of range.
 */
export function solveThrow(from: Vec3, to: Vec3): { yaw: number; pitch: number } | null {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dist = Math.hypot(dx, dz);
  const dy = to.y - from.y;
  const yaw = Math.atan2(-dx, -dz) / (Math.PI / 180);
  let best: { pitch: number; err: number } | null = null;
  for (let pitch = -40; pitch <= 70; pitch += 1) {
    const v = throwVelocity(0, pitch, new Vec3());
    const vh = Math.hypot(v.x, v.z);
    // Solve dy = vy t - 200 t^2 for the descending crossing.
    const disc = v.y * v.y - 800 * dy;
    if (disc < 0) continue;
    const t = (v.y + Math.sqrt(disc)) / 400;
    const err = Math.abs(vh * t - dist);
    if (!best || err < best.err - 1) best = { pitch, err };
  }
  return best && best.err < 150 ? { yaw, pitch: best.pitch } : null;
}
