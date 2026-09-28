import { boxBrush, setBoxBrush, type Brush } from '../engine/brush';
import { PlayerMover, fallDamage } from '../engine/pmove';
import { CollisionWorld, Trace } from '../engine/trace';
import { Vec3, angleVectors } from '../engine/vec';
import type { MapData, Team } from '../maps/types';
import { applyHitGroup, armorAbsorb, switchWeapon, updateWeapon } from './combat';
import type { GameEvent } from './events';
import { GRENADE_IDS, GrenadeSystem, isGrenade } from './grenades';
import { rayHitBody, type HitGroup } from './hitbox';
import { Player, WeaponState } from './player';
import { WEAPONS, type Slot, type WeaponId } from './weapons';

export const TICK_RATE = 100;
export const TICK_DT = 1 / TICK_RATE;

export class DroppedWeapon {
  readonly vel = new Vec3();
  yaw = Math.random() * 360;
  constructor(
    readonly state: WeaponState,
    readonly pos: Vec3,
    /** Whoever dropped it can't instantly pick it back up. */
    public pickupAt: number,
  ) {}
}

/** Hooks the game mode uses to react to sim events. */
export interface Rules {
  onKill?(killer: Player | null, victim: Player): void;
  canMove?(p: Player): boolean;
  canDrop?(p: Player): boolean;
  canAttack?(p: Player): boolean;
  tick?(): void;
}

const DROP_MINS = new Vec3(-6, 0, -6);
const DROP_MAXS = new Vec3(6, 6, 6);

export class Game {
  readonly world: CollisionWorld;
  readonly mover: PlayerMover;
  readonly players: Player[] = [];
  readonly dropped: DroppedWeapon[] = [];
  time = 0;
  events: GameEvent[] = [];
  rules: Rules = {};
  /** Spread and recoil randomness; tests swap in a fixed sequence. */
  rand: () => number = Math.random;
  private playerBoxes = new Map<Player, Brush>();
  private stepTimers = new Map<Player, number>();
  private tr = new Trace();
  readonly grenades: GrenadeSystem;

  constructor(readonly map: MapData) {
    this.world = new CollisionWorld(map.brushes);
    this.mover = new PlayerMover(this.world);
    this.grenades = new GrenadeSystem(this);
  }

  emit(e: GameEvent): void {
    this.events.push(e);
  }

  /** Client drains this each frame. */
  takeEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  private nextPlayerId = 0;

  addPlayer(name: string, team: Team, isBot: boolean): Player {
    // Ids outlive array positions once players can leave (network games).
    const p = new Player(this.nextPlayerId++, name, team, isBot);
    this.players.push(p);
    this.playerBoxes.set(p, boxBrush(new Vec3(), new Vec3(), 'player'));
    p.resetLoadout();
    return p;
  }

  removePlayer(p: Player): void {
    const i = this.players.indexOf(p);
    if (i < 0) return;
    if (p.alive) this.kill(p, null, 'world', false, false);
    this.players.splice(i, 1);
    this.playerBoxes.delete(p);
  }

  spawn(p: Player, index: number): void {
    const spawns = this.map.spawns[p.team];
    const s = spawns[index % spawns.length];
    p.move.origin.copy(s.pos);
    p.move.origin.y += 1;
    p.move.velocity.set(0, 0, 0);
    p.move.ducked = false;
    p.move.duckAmount = 0;
    p.move.jumpPenalty = 0;
    p.yaw = s.yaw;
    p.pitch = 0;
    p.cmd.yaw = s.yaw;
    p.cmd.pitch = 0;
    p.punchPitch = p.punchYaw = 0;
    p.alive = true;
    p.health = 100;
    p.damageFrom.clear();
    p.velocityModifier = 1;
    p.flashUntil = 0;
    if (!p.weapons.knife) p.resetLoadout();
    for (const w of Object.values(p.weapons)) {
      w.zoom = 0;
      w.reloading = false;
      w.shotsFired = 0;
    }
    if (!p.weapons[p.active]) p.active = p.weapons.primary ? 'primary' : 'secondary';
    p.nextAttack = this.time + 0.2;
    this.mover.categorize(p.move);
    p.prevOrigin.copy(p.origin);
  }

  tick(): void {
    for (const p of this.players) {
      p.prevOrigin.copy(p.origin);
      p.prevViewHeight = p.move.viewHeight;
    }
    for (const p of this.players) {
      if (!p.alive) continue;
      p.yaw = p.cmd.yaw;
      p.pitch = p.cmd.pitch;
      this.handleInventoryCmds(p);
      if (p.noclip) {
        this.fly(p);
        continue;
      }
      this.movePlayer(p);
      updateWeapon(this, p, TICK_DT);
    }
    this.updateDropped();
    this.grenades.update(TICK_DT);
    this.rules.tick?.();
    this.time += TICK_DT;
  }

  private handleInventoryCmds(p: Player): void {
    const c = p.cmd;
    if (c.slot) {
      if (c.slot === 'grenade' && p.active === 'grenade') this.cycleGrenade(p);
      else switchWeapon(this, p, c.slot);
      c.slot = null;
    }
    if (c.drop) {
      c.drop = false;
      this.dropActive(p);
    }
  }

  private movePlayer(p: Player): void {
    const frozen = this.rules.canMove && !this.rules.canMove(p);
    const cmd = frozen ? { ...p.cmd, forward: 0, side: 0, jump: false } : p.cmd;
    this.mover.others = this.solidsExcept(p);
    this.mover.move(p.move, cmd, p.maxSpeed(), TICK_DT);

    if (p.velocityModifier < 1) {
      p.velocityModifier = Math.min(1, p.velocityModifier + 0.01);
      p.move.velocity.x *= p.velocityModifier;
      p.move.velocity.z *= p.velocityModifier;
    }

    if (p.move.justJumped) this.emit({ type: 'jump', player: p });
    if (p.move.justLanded) {
      const dmg = fallDamage(p.move.landSpeed);
      if (dmg > 0) this.damage(p, null, dmg, null, 'world', new Vec3(0, -1, 0), false);
      if (p.move.landSpeed > 300) {
        this.emit({ type: 'step', player: p, land: true, tex: this.groundTex(p) });
        p.lastNoise = { time: this.time, radius: 900 };
      }
    }

    // Footsteps only when running: walking or crouching is silent, as in 1.6.
    const speed = p.move.velocity.length2d();
    let t = this.stepTimers.get(p) ?? 0;
    t -= TICK_DT;
    if (p.move.onGround && speed >= 150 && !p.move.ducked) {
      if (t <= 0) {
        this.emit({ type: 'step', player: p, land: false, tex: this.groundTex(p) });
        p.lastNoise = { time: this.time, radius: 1100 };
        t = 0.35;
      }
    }
    this.stepTimers.set(p, t);
  }

  private groundTex(p: Player): string {
    const from = p.origin.clone();
    from.y += 1;
    const to = p.origin.clone();
    to.y -= 8;
    this.world.trace(from, to, undefined, undefined, this.tr);
    return this.tr.brush?.tex ?? '';
  }

  private fly(p: Player): void {
    const f = new Vec3();
    const r = new Vec3();
    angleVectors(p.yaw, p.pitch, f, r);
    const speed = p.cmd.walk ? 200 : 800;
    p.move.velocity.set(0, 0, 0).addScaled(f, p.cmd.forward * speed).addScaled(r, p.cmd.side * speed);
    p.move.origin.addScaled(p.move.velocity, TICK_DT);
  }

  private solidsExcept(self: Player): Brush[] {
    const out: Brush[] = [];
    for (const p of this.players) {
      if (p === self || !p.alive) continue;
      const b = this.playerBoxes.get(p)!;
      setBoxBrush(b, p.origin.clone().add(p.move.mins), p.origin.clone().add(p.move.maxs));
      out.push(b);
    }
    return out;
  }

  nearestBodyHit(start: Vec3, dir: Vec3, maxDist: number, skip: Set<Player>): { player: Player; dist: number; group: HitGroup } | null {
    let best: { player: Player; dist: number; group: HitGroup } | null = null;
    for (const p of this.players) {
      if (!p.alive || skip.has(p)) continue;
      const hit = rayHitBody(start, dir, best ? best.dist : maxDist, p.origin, p.yaw, p.move.ducked ? 1 : p.move.duckAmount);
      if (hit) best = { player: p, dist: hit.dist, group: hit.group };
    }
    return best;
  }

  damage(victim: Player, attacker: Player | null, raw: number, group: HitGroup | null, weapon: WeaponId | 'world', dir: Vec3, wallbang: boolean): void {
    if (!victim.alive) return;
    // No friendly fire, like most casual 1.6 servers.
    if (attacker && attacker !== victim && attacker.team === victim.team) return;
    let dmg = applyHitGroup(raw, group);
    const def = weapon === 'world' ? null : WEAPONS[weapon];
    const armored = victim.armor > 0 && group !== 'legs' && (group !== 'head' || victim.helmet) && group !== null;
    if (armored && def) {
      const r = armorAbsorb(dmg, victim.armor, def.armorPen);
      dmg = r.health;
      victim.armor = Math.max(0, Math.round(victim.armor - r.armor));
    }
    const amount = Math.max(1, Math.floor(dmg));
    if (attacker && attacker !== victim) {
      const real = Math.min(amount, Math.max(0, victim.health));
      attacker.damageDealt += real;
      victim.damageFrom.set(attacker, (victim.damageFrom.get(attacker) ?? 0) + real);
    }
    victim.health -= amount;
    victim.lastDamageTime = this.time;
    if (attacker && attacker !== victim) victim.lastAttacker = attacker;
    if (weapon !== 'world' && weapon !== 'knife') victim.velocityModifier = 0.5;
    // Aim punch: getting hit knocks the view a little.
    victim.punchPitch += Math.min(3, amount * 0.05) * (this.rand() < 0.5 ? 1 : -0.5);
    this.emit({ type: 'hurt', victim, attacker, amount, group, dir });
    if (victim.health <= 0) this.kill(victim, attacker, weapon, group === 'head', wallbang);
  }

  kill(victim: Player, killer: Player | null, weapon: WeaponId | 'world', headshot: boolean, wallbang: boolean): void {
    victim.alive = false;
    victim.health = 0;
    victim.deaths++;
    if (killer && killer !== victim) {
      killer.kills++;
      killer.roundKills++;
      if (headshot) killer.headshots++;
    } else if (killer === victim || !killer) victim.kills--;
    // 1.6 has no assists; CS:GO's rule is 41+ damage to someone a teammate finished.
    for (const [who, dmg] of victim.damageFrom) if (who !== killer && who.team !== victim.team && dmg > 40) who.assists++;
    victim.damageFrom.clear();
    // Drop the best gun, as 1.6 does on death.
    const slot: Slot | null = victim.weapons.primary ? 'primary' : victim.weapons.secondary ? 'secondary' : null;
    if (slot) this.dropSlot(victim, slot, 0);
    if (victim.weapons.c4) this.dropSlot(victim, 'c4', 0);
    victim.weapons = { knife: victim.weapons.knife };
    victim.grenades = {};
    victim.armor = 0;
    victim.helmet = false;
    victim.defuser = false;
    this.emit({ type: 'kill', killer, victim, weapon, headshot, wallbang });
    this.rules.onKill?.(killer, victim);
  }

  dropActive(p: Player): void {
    if (p.active === 'knife' || p.active === 'grenade') return;
    if (this.rules.canDrop && !this.rules.canDrop(p)) return;
    this.dropSlot(p, p.active, 250);
    const next: Slot = p.weapons.primary ? 'primary' : p.weapons.secondary ? 'secondary' : 'knife';
    p.active = 'knife';
    p.weapons[p.active] ??= p.give('knife');
    switchWeapon(this, p, next);
  }

  private dropSlot(p: Player, slot: Slot, throwSpeed: number): void {
    const w = p.weapons[slot];
    if (!w) return;
    delete p.weapons[slot];
    w.zoom = 0;
    w.reloading = false;
    w.burstLeft = 0;
    const eye = p.eye();
    const fwd = new Vec3();
    angleVectors(p.yaw, p.pitch, fwd);
    const d = new DroppedWeapon(w, eye.addScaled(fwd, 8).add(new Vec3(0, -16, 0)), this.time + 0.5);
    d.vel.copy(fwd).scale(throwSpeed).add(p.move.velocity);
    d.vel.y += throwSpeed * 0.3;
    // Don't let it spawn inside a wall.
    this.world.trace(p.eye(), d.pos, DROP_MINS, DROP_MAXS, this.tr);
    d.pos.copy(this.tr.endpos);
    this.dropped.push(d);
  }

  private updateDropped(): void {
    for (const d of this.dropped) {
      if (d.vel.x || d.vel.y || d.vel.z) {
        d.vel.y -= 800 * TICK_DT;
        const to = d.pos.clone().addScaled(d.vel, TICK_DT);
        this.world.trace(d.pos, to, DROP_MINS, DROP_MAXS, this.tr);
        d.pos.copy(this.tr.endpos);
        if (this.tr.fraction < 1) {
          const n = this.tr.normal;
          const vn = d.vel.dot(n);
          d.vel.addScaled(n, -vn * 1.4);
          if (n.y > 0.7) {
            d.vel.scale(0.5);
            if (d.vel.length() < 20) d.vel.set(0, 0, 0);
          }
        }
      }
      for (const p of this.players) {
        if (!p.alive || this.time < d.pickupAt) continue;
        if (p.weapons[d.state.def.slot]) continue;
        if (d.state.def.slot === 'c4' && p.team !== 'T') continue;
        const dx = p.origin.x - d.pos.x;
        const dz = p.origin.z - d.pos.z;
        const dy = d.pos.y - p.origin.y;
        if (dx * dx + dz * dz < 40 * 40 && dy > -16 && dy < 72) {
          p.weapons[d.state.def.slot] = d.state;
          d.pickupAt = Infinity;
          this.emit({ type: 'pickup', player: p, weapon: d.state.def.id });
          break;
        }
      }
    }
    for (let i = this.dropped.length - 1; i >= 0; i--) if (this.dropped[i].pickupAt === Infinity) this.dropped.splice(i, 1);
  }

  /** Pressing 4 again while holding a grenade moves to the next type you carry. */
  private cycleGrenade(p: Player): void {
    const cur = p.weapons.grenade?.def.id;
    const i = GRENADE_IDS.findIndex((g) => g === cur);
    for (let k = 1; k <= GRENADE_IDS.length; k++) {
      const id = GRENADE_IDS[(i + k) % GRENADE_IDS.length];
      if ((p.grenades[id] ?? 0) > 0 && id !== cur) {
        p.give(id);
        p.deployedAt = this.time;
        p.nextAttack = this.time + 0.3;
        this.emit({ type: 'draw', player: p, weapon: id });
        return;
      }
    }
  }

  /** After a throw: next grenade of the same kind, another kind, or back to a gun. */
  afterThrow(p: Player): void {
    const id = p.weapons.grenade?.def.id;
    if (!id) return;
    p.grenades[id] = Math.max(0, (p.grenades[id] ?? 1) - 1);
    const next = (p.grenades[id] ?? 0) > 0 ? id : GRENADE_IDS.find((g) => (p.grenades[g] ?? 0) > 0);
    if (next) {
      p.give(next);
      p.deployedAt = this.time;
      p.nextAttack = this.time + 0.5;
      return;
    }
    delete p.weapons.grenade;
    const back: Slot = p.lastSlot !== 'grenade' && p.weapons[p.lastSlot] ? p.lastSlot : p.weapons.primary ? 'primary' : p.weapons.secondary ? 'secondary' : 'knife';
    p.active = 'grenade';
    switchWeapon(this, p, back);
  }

  /** Buy/equip helper used by rules and tests. */
  equip(p: Player, id: WeaponId): void {
    const def = WEAPONS[id];
    if (def.slot === 'grenade') {
      p.grenades[id] = (p.grenades[id] ?? 0) + 1;
      if (!p.weapons.grenade && isGrenade(id)) p.give(id);
      return;
    }
    if (p.weapons[def.slot] && def.slot !== 'knife') this.dropSlot(p, def.slot, 100);
    const w = p.give(id);
    if (p.active === def.slot) {
      p.nextAttack = this.time + def.deploy;
      p.deployedAt = this.time;
      this.emit({ type: 'draw', player: p, weapon: w.def.id });
    } else if (def.slot === 'primary' || (def.slot === 'secondary' && !p.weapons.primary)) {
      switchWeapon(this, p, def.slot);
    }
  }
}
