import { Trace } from '../engine/trace';
import { DEG, Vec3, angleDiff, angleVectors, pitchTo, yawTo } from '../engine/vec';
import { HULL_STAND } from '../engine/pmove';
import { solveThrow, type GrenadeId } from '../game/grenades';
import type { Player } from '../game/player';
import type { BotManager } from './manager';
import type { NavNode } from './nav';
import type { Skill } from './skill';

/** How far a bot will stand and shoot with what it's holding. */
function engageRange(p: Player): number {
  const w = p.weapons.primary ?? p.weapons.secondary;
  if (!w) return 100;
  const d = w.def;
  if (d.zoom && d.zoom.length > 1) return 6000;
  if (d.pellets) return 700;
  if (d.slot === 'secondary') return d.id === 'deagle' ? 1800 : 1300;
  if (d.damage < 30 && d.slot === 'primary' && d.speed >= 245) return 1600;
  return 3500;
}

export type Task =
  | { kind: 'idle' }
  /** Walk to a spot, then hold it looking at `look`. */
  | { kind: 'hold'; spot: Vec3; look: Vec3 }
  /** Wait at a spot outside a site until the team is ready, then do `then`. */
  | { kind: 'stage'; spot: Vec3; look: Vec3; then: Task }
  /** Push along a waypoint to a destination. */
  | { kind: 'go'; via: Vec3 | null; dest: Vec3; then?: Task }
  | { kind: 'plant'; spot: Vec3 }
  | { kind: 'defuse'; bomb: Vec3 }
  | { kind: 'fetch'; pos: Vec3 }
  /** Walk over a gun on the floor to pick it up, then carry on with `then`. */
  | { kind: 'grab'; pos: Vec3; then: Task }
  /** Deathmatch or late round: roam and fight. */
  | { kind: 'hunt'; dest: Vec3 | null }
  /** Stay near a teammate (the human, usually), watching where they aren't. */
  | { kind: 'follow'; leader: Player; until: number };

const tr = new Trace();
const LIFT = new Vec3(0, 18, 0);

export class Bot {
  task: Task = { kind: 'idle' };
  // Navigation
  private path: NavNode[] = [];
  private pathIdx = 0;
  private pathGoal: Vec3 | null = null;
  private nextSmooth = 0;
  private stuckTime = 0;
  private lastPos = new Vec3();
  private repathAt = 0;
  // Perception
  enemy: Player | null = null;
  private visible = false;
  private reactEnd = 0;
  private lastSeen = -10;
  private lastSeenPos = new Vec3();
  heard: { pos: Vec3; time: number } | null = null;
  /** How many enemies were in sight on the last perception pass. */
  visibleCount = 0;
  fellBack = false;
  /** When each enemy was last acquired as a fresh target (for tuning and debugging). */
  readonly acquiredAt = new Map<Player, number>();
  // Aim
  private yaw = 0;
  private pitch = 0;
  private errYaw = 0;
  private errPitch = 0;
  private errStart = 0;
  private aimHead = false;
  private burstPause = 0;
  private triggerDown = false;
  // Movement flavour
  private strafeDir = 1;
  private strafeUntil = 0;
  private crouching = false;
  private stopping = false;
  private nextPerceive = 0;
  private lookJitter = 0;
  private lookJitterAt = 0;
  private wantReloadAt = 0;
  /** A grenade being lined up: switch to it, aim, pull, release. */
  private nade: { id: GrenadeId; yaw: number; pitch: number; stage: 'switch' | 'aim' | 'pull'; until: number; precise: boolean } | null = null;
  /** Throws the team asked for, in order: this grenade, at this spot, from wherever we stand at time `at`. */
  plans: { id: GrenadeId; target: Vec3; at: number }[] = [];
  /** When our last grenade left the hand, and which kind. */
  lastThrow = { id: null as GrenadeId | null, time: -10 };
  private nadeCooldown = 0;
  private usedFlash = false;
  private usedSmoke = false;

  constructor(
    readonly p: Player,
    readonly mgr: BotManager,
    public skill: Skill,
  ) {}

  lastSeenTime(): number {
    return this.lastSeen;
  }

  onSpawn(): void {
    this.yaw = this.p.yaw;
    this.pitch = 0;
    this.path = [];
    this.pathGoal = null;
    this.enemy = null;
    this.heard = null;
    this.task = { kind: 'idle' };
    this.lastPos.copy(this.p.origin);
    this.stuckTime = 0;
    this.nade = null;
    this.plans = [];
    this.usedFlash = this.usedSmoke = false;
    this.fellBack = false;
    this.nadeCooldown = this.mgr.game.time + 3;
  }

  private get time(): number {
    return this.mgr.game.time;
  }

  private rand(): number {
    return this.mgr.game.rand();
  }

  /** Called every tick before the sim; writes the bot's UserCmd. */
  update(dt: number): void {
    const p = this.p;
    const c = p.cmd;
    c.forward = c.side = 0;
    c.jump = c.duck = c.walk = c.attack = c.attack2 = c.reload = c.use = false;

    if (this.time >= this.nextPerceive) {
      this.perceive();
      this.nextPerceive = this.time + 0.05;
    }

    // Only fight what the current gun can realistically hit; otherwise keep playing the objective.
    const engaged = !!this.enemy && this.visible && this.enemy.alive && this.enemy.origin.distanceTo(p.origin) < engageRange(p);
    let moveDir: Vec3 | null = null;
    let lookAt: Vec3 | null = null;

    // Objective handling.
    const t = this.task;
    if (t.kind === 'plant' && p.weapons.c4) {
      if (this.mgr.siteAt(p.origin) && p.move.onGround && !engaged) {
        c.slot = p.active === 'c4' ? null : 'c4';
        if (p.active === 'c4') c.attack = true;
        c.duck = true;
      } else {
        moveDir = this.follow(t.spot);
      }
    } else if (t.kind === 'defuse') {
      const d = Math.hypot(p.origin.x - t.bomb.x, p.origin.z - t.bomb.z);
      const urgent = this.mgr.bombTimeLeft() < (p.defuser ? 6.5 : 11.5);
      if (d < 48 && (!engaged || urgent)) {
        c.use = true;
        c.duck = true;
        lookAt = t.bomb;
      } else if (!engaged || urgent) {
        moveDir = this.follow(t.bomb);
      }
    }

    if (engaged && !(t.kind === 'defuse' && c.use)) {
      this.nade = null;
      this.combat(dt);
      lookAt = null;
    } else if (this.nade || this.planNade()) {
      this.throwNade(dt);
      if (moveDir && this.nade?.stage === 'switch') this.steer(moveDir);
    } else {
      this.triggerDown = false;
      if (!moveDir && !c.use && t.kind !== 'plant') {
        const goal = this.goalPos();
        if (goal) moveDir = this.follow(goal);
        if ((t.kind === 'hold' || t.kind === 'stage') && !moveDir) lookAt = t.look;
      }
      // Walk the last stretch into a hold quietly, like a player would.
      if (t.kind === 'hold' && moveDir && Math.hypot(t.spot.x - p.origin.x, t.spot.z - p.origin.z) < 250) c.walk = true;
      this.maintainWeapon();
      const flash = this.friendlyFlash();
      if (flash) {
        // "Flash out": turn your back on it until it pops.
        this.turnToward(p.eye().scale(2).sub(flash), dt, 1);
      } else {
        if (!lookAt) lookAt = this.idleLook(moveDir);
        if (lookAt) this.turnToward(lookAt, dt, 0.5);
      }
    }

    if (moveDir && !(engaged && this.stopping)) this.steer(moveDir);
    c.yaw = this.yaw;
    c.pitch = this.pitch;
  }

  private goalPos(): Vec3 | null {
    const t = this.task;
    switch (t.kind) {
      case 'hold':
      case 'stage':
        return Math.hypot(t.spot.x - this.p.origin.x, t.spot.z - this.p.origin.z) > 20 ? t.spot : null;
      case 'go': {
        if (t.via && Math.hypot(t.via.x - this.p.origin.x, t.via.z - this.p.origin.z) < 120) t.via = null;
        if (t.via) return t.via;
        if (Math.hypot(t.dest.x - this.p.origin.x, t.dest.z - this.p.origin.z) < 64) {
          this.task = t.then ?? { kind: 'hunt', dest: null };
          return null;
        }
        return t.dest;
      }
      case 'fetch':
        return t.pos;
      case 'follow': {
        const l = t.leader;
        if (!l.alive || this.time > t.until) {
          this.task = { kind: 'hunt', dest: null };
          return null;
        }
        // Trail a little behind and to the side so we're not in the leader's line of fire.
        const d = Math.hypot(l.origin.x - this.p.origin.x, l.origin.z - this.p.origin.z);
        return d > 170 ? l.origin : null;
      }
      case 'grab':
        if (this.p.weapons.primary || Math.hypot(t.pos.x - this.p.origin.x, t.pos.z - this.p.origin.z) < 24) {
          this.task = t.then;
          return null;
        }
        return t.pos;
      case 'hunt': {
        // Chase what we last knew about, otherwise roam.
        if (this.enemy && this.time - this.lastSeen < 4) return this.lastSeenPos;
        if (this.heard && this.time - this.heard.time < 4) return this.heard.pos;
        if (!t.dest || Math.hypot(t.dest.x - this.p.origin.x, t.dest.z - this.p.origin.z) < 80) t.dest = this.mgr.randomNode().pos.clone();
        return t.dest;
      }
      default:
        if (this.enemy && this.time - this.lastSeen < 3) return this.lastSeenPos;
        return null;
    }
  }

  // ---------------------------------------------------------------- perception

  private perceive(): void {
    const p = this.p;
    const g = this.mgr.game;
    const eye = p.eye();
    const fwd = new Vec3();
    angleVectors(this.yaw, this.pitch, fwd);
    const cosFov = Math.cos(this.skill.fov * DEG);
    // Properly flashed bots see nothing until it wears off.
    const blind = p.flashUntil - this.time > 0.7 && p.flashStrength > 0.35;

    let best: Player | null = null;
    let bestD = Infinity;
    this.visibleCount = 0;
    for (const e of g.players) {
      if (!e.alive || e.team === p.team || e === p) continue;
      const d = e.origin.distanceTo(p.origin);
      if (d > 5000) continue;
      const to = e.eye().sub(eye);
      to.normalize();
      // Things already being tracked stay tracked outside the cone for a moment.
      const tracked = e === this.enemy && this.time - this.lastSeen < 0.5;
      if (blind) continue;
      if (!tracked && fwd.dot(to) < cosFov && d > 120) continue;
      if (!this.canSee(eye, e)) continue;
      this.visibleCount++;
      // Prefer whoever is closest, but stick with the current target unless someone is much closer.
      const score = d * (e === this.enemy ? 0.6 : 1);
      if (score < bestD) {
        bestD = score;
        best = e;
      }
    }

    if (best) {
      const fresh = best !== this.enemy || this.time - this.lastSeen > 0.6;
      if (fresh) this.acquire(best);
      this.enemy = best;
      this.visible = true;
      this.lastSeen = this.time;
      this.lastSeenPos.copy(best.origin);
      this.mgr.report(p, best);
    } else {
      this.visible = false;
      if (this.enemy && (!this.enemy.alive || this.time - this.lastSeen > 5)) this.enemy = null;
    }

    // Hearing: footsteps and gunfire within range.
    for (const e of g.players) {
      if (!e.alive || e.team === p.team) continue;
      const n = e.lastNoise;
      if (g.time - n.time > 0.06) continue;
      const d = e.origin.distanceTo(p.origin);
      if (d > n.radius * this.skill.hearing) continue;
      const fuzz = Math.min(300, d * 0.15);
      this.heard = { pos: e.origin.clone().add(new Vec3((this.rand() - 0.5) * fuzz, 0, (this.rand() - 0.5) * fuzz)), time: g.time };
      // Sounds count as intel for the team too (footsteps on B, shots on long).
      this.mgr.report(p, e, this.heard.pos);
    }
    // Getting shot by someone we can't see: look their way.
    if (p.lastAttacker && g.time - p.lastDamageTime < 0.1 && p.lastAttacker !== this.enemy) {
      this.heard = { pos: p.lastAttacker.origin.clone(), time: g.time };
    }
  }

  private canSee(eye: Vec3, e: Player): boolean {
    const w = this.mgr.game.world;
    const o = e.origin;
    const top = e.move.viewHeight;
    for (const h of [top, top * 0.62, top * 0.25]) {
      const pt = new Vec3(o.x, o.y + h, o.z);
      if (w.visible(eye, pt) && !this.mgr.smokeBlocks(eye, pt)) return true;
    }
    return false;
  }

  private acquire(e: Player): void {
    const s = this.skill;
    this.acquiredAt.set(e, this.time);
    // Flashed bots react much slower; one already aiming near where the enemy appears reacts faster.
    const flash = this.p.flashUntil > this.time ? 3 : 1;
    const eye = this.p.eye();
    const off = Math.hypot(angleDiff(yawTo(eye, e.eye()), this.yaw), pitchTo(eye, e.eye()) - this.pitch);
    const preaim = off < 12 ? 0.7 : off > 45 ? 1.25 : 1;
    this.reactEnd = this.time + s.reaction * (0.75 + this.rand() * 0.6) * flash * preaim;
    const dist = e.origin.distanceTo(this.p.origin);
    const err = s.aimError * (0.6 + this.rand() * 0.8) * (dist > 1500 ? 0.7 : 1);
    const a = this.rand() * Math.PI * 2;
    this.errYaw = Math.cos(a) * err;
    this.errPitch = Math.sin(a) * err * 0.6;
    this.errStart = this.time;
    this.aimHead = this.rand() < s.headChance;
  }

  // ---------------------------------------------------------------- utility

  /** Decide whether there's a grenade worth throwing right now. */
  private planNade(): boolean {
    const p = this.p;
    const has = (id: GrenadeId) => (p.grenades[id] ?? 0) > 0;
    // Team-called utility comes first and uses a proper lineup.
    const plan = this.plans[0];
    if (plan && this.time >= plan.at && p.move.onGround) {
      this.plans.shift();
      if (!has(plan.id)) return false;
      const eye = p.eye();
      const l = this.mgr.lineup(plan.id, eye, plan.target);
      const aim = l ?? solveThrow(eye, plan.target);
      if (!aim) return false;
      this.nade = { id: plan.id, yaw: aim.yaw, pitch: aim.pitch, stage: 'switch', until: this.time + 4, precise: !!l };
      return true;
    }
    if (this.time < this.nadeCooldown || !p.move.onGround || this.task.kind === 'plant' || this.task.kind === 'defuse') return false;
    const eye = p.eye();
    let id: GrenadeId | null = null;
    let target: Vec3 | null = null;

    const he = has('hegrenade') ? this.mgr.grenadeTarget(p) : null;
    if (he) {
      id = 'hegrenade';
      target = he;
    } else if (p.team === 'T' && !this.usedFlash && has('flashbang') && this.task.kind !== 'stage' && !this.plans.length) {
      // Pop a flash over the entrance just before walking into the site (executes plan their own).
      const e = this.mgr.siteEntranceFor(p);
      if (e && e.entrance.distanceTo(p.origin) < 700 && e.entrance.distanceTo(p.origin) > 250) {
        id = 'flashbang';
        target = e.site.center.pos.clone();
        this.usedFlash = true;
      }
    } else if (p.team === 'CT' && !this.usedSmoke && has('smokegrenade') && this.task.kind === 'hold') {
      const c = this.mgr.pushingContact(p);
      if (c) {
        id = 'smokegrenade';
        target = c;
        this.usedSmoke = true;
      }
    }
    if (!id || !target) return false;
    const aim = solveThrow(eye, target);
    this.nadeCooldown = this.time + 4;
    if (!aim) return false;
    // Flashes go high over the wall so they pop in the air.
    const pitch = id === 'flashbang' ? Math.max(aim.pitch, 25) : aim.pitch;
    this.nade = { id, yaw: aim.yaw + (this.rand() - 0.5) * 6, pitch: pitch + (this.rand() - 0.5) * 4, stage: 'switch', until: this.time + 3, precise: false };
    return true;
  }

  /** A teammate's flash about to pop somewhere we'd see it. */
  private friendlyFlash(): Vec3 | null {
    const g = this.mgr.game;
    const eye = this.p.eye();
    for (const n of g.grenades.live) {
      if (n.id !== 'flashbang' || n.thrower.team !== this.p.team) continue;
      const left = n.detonateAt - g.time;
      if (left > 0.9 || left < 0 || n.pos.distanceTo(eye) > 1500 || !g.world.visible(eye, n.pos)) continue;
      return n.pos;
    }
    return null;
  }

  private throwNade(dt: number): void {
    const p = this.p;
    const c = p.cmd;
    const n = this.nade;
    if (!n) return;
    if (this.time > n.until || (p.grenades[n.id] ?? 0) <= 0) {
      this.nade = null;
      return;
    }
    // Nobody lines up a throw with a teammate's flash about to pop in their face.
    const flash = n.stage !== 'pull' ? this.friendlyFlash() : null;
    if (flash) {
      this.turnToward(p.eye().scale(2).sub(flash), dt, 1);
      n.until += dt;
      if (n.stage === 'aim') return;
    } else this.turnAngles(n.yaw, n.pitch, dt, 1);
    switch (n.stage) {
      case 'switch':
        if (p.active !== 'grenade' || p.weapons.grenade?.def.id !== n.id) c.slot = 'grenade';
        else n.stage = 'aim';
        break;
      case 'aim': {
        // A lineup only works if you stand still and put the crosshair exactly on it.
        const tol = n.precise ? 0.4 : 3;
        const still = !n.precise || p.move.velocity.length2d() < 10;
        if (Math.abs(angleDiff(this.yaw, n.yaw)) < tol && Math.abs(this.pitch - n.pitch) < tol && still && this.time >= p.nextAttack) n.stage = 'pull';
        break;
      }
      case 'pull':
        // Hold for a tick to pull the pin, then let go to throw.
        if (!p.weapon?.pinPulled) c.attack = true;
        else {
          c.attack = false;
          this.lastThrow = { id: n.id, time: this.time };
          this.nade = null;
          this.nadeCooldown = this.time + 2;
        }
        break;
    }
  }

  // ---------------------------------------------------------------- combat

  private aimPoint(e: Player): Vec3 {
    const o = e.origin;
    const vh = e.move.viewHeight;
    return new Vec3(o.x, o.y + (this.aimHead ? vh - 1 : vh * 0.6), o.z);
  }

  private combat(dt: number): void {
    const p = this.p;
    const c = p.cmd;
    const e = this.enemy!;
    const s = this.skill;
    const w = p.weapon;
    const eye = p.eye();
    const target = this.aimPoint(e);
    const dist = eye.distanceTo(target);

    // Aim error settles exponentially while tracking.
    const k = Math.exp(-(this.time - this.errStart) / s.settle);
    const wantYaw = yawTo(eye, target) + this.errYaw * k - p.punchYaw * s.recoilComp * 2;
    const wantPitch = pitchTo(eye, target) + this.errPitch * k - p.punchPitch * s.recoilComp * 2;
    const reacting = this.time < this.reactEnd;
    // Before reacting the bot only drifts toward the target.
    this.turnAngles(wantYaw, wantPitch, dt, reacting ? 0.25 : 1);

    this.pickWeapon(dist);
    if (!w || w.def.slot === 'c4' || w.def.slot === 'grenade') {
      c.slot = p.weapons.primary ? 'primary' : p.weapons.secondary ? 'secondary' : 'knife';
      return;
    }

    // Snipers scope in before shooting.
    if (w.def.zoom && w.def.zoom.length > 1 && w.zoom === 0 && dist > 300 && !w.reloading && this.time >= p.nextAttack - 0.2) c.attack2 = true;

    const speed = p.move.velocity.length2d();
    const errToTarget = Math.hypot(angleDiff(this.yaw + p.punchYaw, yawTo(eye, target)), this.pitch + p.punchPitch - pitchTo(eye, target));
    const radius = this.aimHead ? 5 : 10;
    const window = (Math.atan2(radius, dist) / DEG) * s.sloppy + 0.3;

    // Fire control by distance: tap far, burst mid, spray close.
    let maxBurst = 30;
    if (w.def.auto) {
      const disc = s.burstDiscipline;
      if (dist > 1400) maxBurst = disc > 0.5 ? 1 : 3;
      else if (dist > 800) maxBurst = disc > 0.5 ? 3 : 6;
      else if (dist > 400) maxBurst = disc > 0.3 ? 7 : 12;
    }
    if (w.def.id === 'knife') {
      this.triggerDown = dist < 60;
      c.attack = this.triggerDown && !reacting;
    } else {
      const sniper = !!w.def.zoom && w.def.zoom.length > 1;
      let ready = !reacting && errToTarget < window && this.time >= this.burstPause && w.clip > 0;
      if (sniper) ready = ready && (w.zoom > 0 || dist < 300) && speed < 80;
      if (ready) {
        if (w.def.auto) {
          c.attack = true;
          if (w.shotsFired >= maxBurst) {
            c.attack = false;
            this.burstPause = this.time + 0.2 + maxBurst * 0.04 + this.rand() * 0.15;
          }
        } else {
          // Semi-autos need the trigger released between shots.
          this.triggerDown = !this.triggerDown;
          c.attack = this.triggerDown;
          if (dist > 600 && w.def.slot === 'secondary' && this.time - w.lastFire < 0.35) c.attack = false;
        }
      } else {
        this.triggerDown = false;
      }
      if (w.clip === 0 && w.reserve > 0) c.reload = true;
    }

    // Movement: counter-strafe to shoot, ADAD between bursts, crouch sprays.
    const shooting = c.attack;
    if (shooting || (!reacting && errToTarget < window * 2)) {
      if (this.stopping || this.rand() < s.stopToShoot * dt * 20) this.stopping = true;
    } else this.stopping = false;
    if (this.stopping && speed > 40) {
      // Tap the opposite direction to kill momentum, like a counter-strafe.
      const v = p.move.velocity.clone();
      v.y = 0;
      v.normalize();
      this.steer(v.scale(-1));
    } else if (!shooting && this.rand() < s.strafe && dist < 1800) {
      if (this.time > this.strafeUntil) {
        this.strafeDir = this.rand() < 0.5 ? -1 : 1;
        this.strafeUntil = this.time + 0.25 + this.rand() * 0.45;
      }
      c.side = this.strafeDir;
    }
    if (shooting && w.def.auto && dist < 900) {
      if (!this.crouching && w.shotsFired === 1) this.crouching = this.rand() < s.crouch;
    } else if (!shooting) this.crouching = false;
    c.duck = this.crouching;
  }

  private pickWeapon(dist: number): void {
    const p = this.p;
    const c = p.cmd;
    const prim = p.weapons.primary;
    const sec = p.weapons.secondary;
    const w = p.weapon;
    // Out of ammo mid-fight: pistol is faster than reloading.
    if (w?.def.slot === 'primary' && w.clip === 0 && sec && sec.clip > 0 && dist < 1200) c.slot = 'secondary';
    else if (w?.def.slot === 'knife' && (prim?.clip || sec?.clip)) c.slot = prim?.clip ? 'primary' : 'secondary';
    else if (w?.def.slot === 'secondary' && prim && prim.clip > 0 && !w.clip) c.slot = 'primary';
  }

  private maintainWeapon(): void {
    const p = this.p;
    const c = p.cmd;
    const w = p.weapon;
    if (!w) return;
    if (p.active !== 'primary' && p.weapons.primary && (p.weapons.primary.clip > 0 || p.weapons.primary.reserve > 0) && p.active !== 'c4') c.slot = 'primary';
    else if (p.active === 'knife' && p.weapons.secondary) c.slot = 'secondary';
    if (w.def.zoom && w.zoom > 0 && this.time - this.lastSeen > 2) c.attack2 = !this.triggerDown;
    // Reload once things have been quiet for a moment.
    if (w.def.clip > 0 && w.clip < w.def.clip * 0.5 && w.reserve > 0 && !w.reloading) {
      if (this.time - this.lastSeen > 1.5 && this.time >= this.wantReloadAt) {
        c.reload = true;
        this.wantReloadAt = this.time + 1;
      }
    }
  }

  // ---------------------------------------------------------------- looking

  private idleLook(moveDir: Vec3 | null): Vec3 | null {
    const p = this.p;
    const eye = p.eye();
    if (this.heard && this.time - this.heard.time < 3) return this.heard.pos.clone().add(new Vec3(0, 60, 0));
    if (this.enemy && this.time - this.lastSeen < 2) return this.aimPoint(this.enemy);
    const intel = this.mgr.threatNear(p);
    if (intel) return intel;
    if (moveDir) {
      if (this.time > this.lookJitterAt) {
        this.lookJitter = (this.rand() - 0.5) * 50;
        this.lookJitterAt = this.time + 0.6 + this.rand() * 1.2;
      }
      const ahead = this.path[Math.min(this.path.length - 1, this.pathIdx + 4)]?.pos ?? eye.clone().add(moveDir.clone().scale(200));
      const dir = ahead.clone().sub(p.origin);
      dir.y = 0;
      dir.normalize();
      const a = Math.atan2(dir.x, dir.z) + this.lookJitter * DEG;
      return new Vec3(eye.x + Math.sin(a) * 300, eye.y, eye.z + Math.cos(a) * 300);
    }
    return null;
  }

  private turnToward(target: Vec3, dt: number, rate: number): void {
    const eye = this.p.eye();
    this.turnAngles(yawTo(eye, target), pitchTo(eye, target), dt, rate);
  }

  private turnAngles(wantYaw: number, wantPitch: number, dt: number, rate: number): void {
    const s = this.skill;
    const maxStep = s.turnSpeed * rate * dt;
    // Proportional approach with a speed cap: fast flicks that ease in, never instant.
    const dy = angleDiff(wantYaw, this.yaw);
    const dp = wantPitch - this.pitch;
    const gain = Math.min(1, dt * 14);
    const sy = Math.max(-maxStep, Math.min(maxStep, dy * gain + Math.sign(dy) * Math.min(Math.abs(dy), 20 * dt)));
    const spn = Math.max(-maxStep, Math.min(maxStep, dp * gain + Math.sign(dp) * Math.min(Math.abs(dp), 20 * dt)));
    this.yaw = (((this.yaw + sy) % 360) + 360) % 360;
    this.pitch = Math.max(-89, Math.min(89, this.pitch + spn));
  }

  // ---------------------------------------------------------------- movement

  /** Returns the world-space direction to walk this tick to make progress toward `goal`. */
  private follow(goal: Vec3): Vec3 | null {
    const p = this.p;
    const nav = this.mgr.nav;
    const t = this.time;
    if (!this.pathGoal || this.pathGoal.distanceTo(goal) > 48 || t >= this.repathAt || this.pathIdx >= this.path.length) {
      const from = nav.nearest(p.origin);
      const to = nav.nearest(goal);
      this.path = from && to ? (nav.path(from, to) ?? []) : [];
      this.pathIdx = 0;
      this.pathGoal = goal.clone();
      this.repathAt = t + 4 + this.rand() * 2;
      if (!this.path.length) return null;
    }

    // Stuck detection: jump, then repath.
    const moved = Math.hypot(p.origin.x - this.lastPos.x, p.origin.z - this.lastPos.z);
    this.lastPos.copy(p.origin);
    if (moved < 0.8 && p.move.onGround && p.velocityModifier >= 1) {
      this.stuckTime += 0.01;
      if (this.stuckTime > 0.4) p.cmd.jump = true;
      if (this.stuckTime > 0.5) p.cmd.duck = this.stuckTime > 0.6;
      if (this.stuckTime > 1.2) {
        this.repathAt = t;
        this.pathIdx = Math.min(this.path.length - 1, this.pathIdx + 1);
        this.stuckTime = 0;
      }
    } else this.stuckTime = Math.max(0, this.stuckTime - 0.02);

    // Advance along the path.
    while (this.pathIdx < this.path.length) {
      const n = this.path[this.pathIdx];
      const d = Math.hypot(n.pos.x - p.origin.x, n.pos.z - p.origin.z);
      if (d < 20 && Math.abs(n.pos.y - p.origin.y) < 40) this.pathIdx++;
      else break;
    }
    // String-pull: skip ahead to the furthest node we can walk to in a straight line.
    if (t >= this.nextSmooth && this.pathIdx < this.path.length) {
      this.nextSmooth = t + 0.15;
      const w = this.mgr.game.world;
      const start = p.origin.clone().add(LIFT);
      for (let j = Math.min(this.path.length - 1, this.pathIdx + 8); j > this.pathIdx; j--) {
        const n = this.path[j];
        if (Math.abs(n.pos.y - p.origin.y) > 20) continue;
        let jumpBetween = false;
        for (let q = this.pathIdx; q < j && !jumpBetween; q++) jumpBetween = !!nav.edge(this.path[q], this.path[q + 1])?.jump;
        if (jumpBetween) continue;
        const end = n.pos.clone().add(LIFT);
        if (w.trace(start, end, HULL_STAND.mins, HULL_STAND.maxs, tr).fraction >= 1) {
          this.pathIdx = j;
          break;
        }
      }
    }
    const next = this.path[this.pathIdx] ?? this.path[this.path.length - 1];
    if (!next) return null;
    // Jump up ledges the graph says need it.
    const prev = this.path[this.pathIdx - 1];
    if (prev && nav.edge(prev, next)?.jump && Math.hypot(next.pos.x - p.origin.x, next.pos.z - p.origin.z) < 56 && p.move.onGround) {
      p.cmd.jump = true;
    }
    if (!p.move.onGround && p.move.velocity.y < 100 && next.pos.y > p.origin.y + 18) p.cmd.duck = true;

    const dir = next.pos.clone().sub(p.origin);
    dir.y = 0;
    const len = dir.normalize();
    if (len < 1) return null;
    // Steer around players standing in the way instead of pushing into them.
    const fx = dir.x;
    const fz = dir.z;
    for (const o of this.mgr.game.players) {
      if (o === p || !o.alive) continue;
      const dx = p.origin.x - o.origin.x;
      const dz = p.origin.z - o.origin.z;
      const d = Math.hypot(dx, dz);
      if (d > 72 || d < 0.01 || Math.abs(o.origin.y - p.origin.y) > 60) continue;
      // Only care about people ahead of us.
      if (-(dx * fx + dz * fz) < 0) continue;
      const w = (72 - d) / 72;
      // Go round on whichever side we're already offset to.
      const side = fx * dz - fz * dx > 0 ? 1 : -1;
      dir.x += -fz * side * w * 1.5;
      dir.z += fx * side * w * 1.5;
    }
    dir.normalize();
    return dir;
  }

  /** Convert a world move direction into forward/side relative to where the bot is looking. */
  private steer(dir: Vec3): void {
    const f = new Vec3();
    const r = new Vec3();
    angleVectors(this.yaw, 0, f, r);
    let fm = dir.x * f.x + dir.z * f.z;
    let sm = dir.x * r.x + dir.z * r.z;
    const m = Math.max(Math.abs(fm), Math.abs(sm));
    if (m > 0.001) {
      fm /= m;
      sm /= m;
    }
    this.p.cmd.forward = fm;
    this.p.cmd.side = this.p.cmd.side || sm;
  }
}
