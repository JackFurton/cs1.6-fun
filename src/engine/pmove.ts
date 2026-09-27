// Player movement ported from GoldSrc/CS 1.6 pm_shared.c, Y-up.
import type { Brush } from './brush';
import { CollisionWorld, Trace } from './trace';
import { Vec3, angleVectors } from './vec';

export const MOVE = {
  gravity: 800,
  friction: 4,
  stopSpeed: 75,
  accelerate: 5,
  airAccelerate: 10,
  maxVelocity: 2000,
  stepSize: 18,
  // sqrt(2 * 800 * 45): a 45 unit jump.
  jumpSpeed: 268.3281572999748,
  duckTime: 0.2,
  duckMultiplier: 0.333,
  walkMultiplier: 0.52,
  maxSafeFallSpeed: 580,
  fatalFallSpeed: 1024,
  // CS 1.6 sets fuser2 to this on jump, so landing speed recovers over ~1.3s.
  jumpPenaltyMs: 1315.789429,
};

export const HULL_STAND = { mins: new Vec3(-16, 0, -16), maxs: new Vec3(16, 72, 16) };
export const HULL_DUCK = { mins: new Vec3(-16, 0, -16), maxs: new Vec3(16, 36, 16) };
export const VIEW_STAND = 64;
export const VIEW_DUCK = 30;

export interface MoveInput {
  forward: number; // -1..1
  side: number; // -1..1, positive = right
  yaw: number;
  jump: boolean;
  duck: boolean;
  walk: boolean;
}

export class MoveState {
  origin = new Vec3();
  velocity = new Vec3();
  onGround = false;
  groundNormal = new Vec3(0, 1, 0);
  ducked = false;
  /** 0 = standing view, 1 = fully ducked view. */
  duckAmount = 0;
  jumpPenalty = 0;
  oldJump = false;
  /** Downward speed at the moment of the last landing, for fall damage and landing sounds. */
  landSpeed = 0;
  justLanded = false;
  justJumped = false;

  get mins(): Vec3 {
    return this.ducked ? HULL_DUCK.mins : HULL_STAND.mins;
  }
  get maxs(): Vec3 {
    return this.ducked ? HULL_DUCK.maxs : HULL_STAND.maxs;
  }
  get viewHeight(): number {
    if (this.ducked) return VIEW_DUCK;
    return VIEW_STAND + (VIEW_DUCK - VIEW_STAND) * this.duckAmount;
  }
}

export function fallDamage(landSpeed: number): number {
  if (landSpeed <= MOVE.maxSafeFallSpeed) return 0;
  return ((landSpeed - MOVE.maxSafeFallSpeed) * 100) / (MOVE.fatalFallSpeed - MOVE.maxSafeFallSpeed);
}

const tr = new Trace();
const tmpA = new Vec3();
const tmpB = new Vec3();
const fwd = new Vec3();
const right = new Vec3();
const wishDir = new Vec3();
const planes: Vec3[] = Array.from({ length: 5 }, () => new Vec3());

export class PlayerMover {
  others: readonly Brush[] = [];
  constructor(readonly world: CollisionWorld) {}

  private trace(start: Vec3, end: Vec3, s: MoveState): Trace {
    return this.world.traceWith(start, end, s.mins, s.maxs, this.others, tr);
  }

  private fits(origin: Vec3, ducked: boolean): boolean {
    const hull = ducked ? HULL_DUCK : HULL_STAND;
    return !this.world.traceWith(origin, origin, hull.mins, hull.maxs, this.others, tr).startsolid;
  }

  /** Advance one tick. maxSpeed is the weapon speed cap (250 knife, 221 AK...). */
  move(s: MoveState, cmd: MoveInput, maxSpeed: number, dt: number): void {
    s.justLanded = false;
    s.justJumped = false;
    if (s.jumpPenalty > 0) s.jumpPenalty = Math.max(0, s.jumpPenalty - dt * 1000);

    this.unstick(s);
    this.duck(s, cmd, dt);
    this.categorize(s);

    let speedCap = maxSpeed;
    if (s.ducked || (cmd.duck && s.onGround)) speedCap *= MOVE.duckMultiplier;
    else if (cmd.walk) speedCap *= MOVE.walkMultiplier;

    angleVectors(cmd.yaw, 0, fwd, right);
    const fm = cmd.forward * 400;
    const sm = cmd.side * 400;
    wishDir.set(fwd.x * fm + right.x * sm, 0, fwd.z * fm + right.z * sm);
    let wishSpeed = wishDir.normalize();
    if (wishSpeed > speedCap) wishSpeed = speedCap;

    if (cmd.jump) {
      if (s.onGround && !s.oldJump) this.jump(s);
      s.oldJump = true;
    } else {
      s.oldJump = false;
    }

    if (s.onGround) {
      s.velocity.y = 0;
      this.friction(s, dt);
      if (s.jumpPenalty > 0) {
        const ratio = (100 - s.jumpPenalty * 0.001 * 19) * 0.01;
        s.velocity.x *= ratio;
        s.velocity.z *= ratio;
      }
      this.accelerate(s, wishDir, wishSpeed, MOVE.accelerate, dt);
      this.clampVelocity(s);
      this.walkMove(s, dt);
    } else {
      s.velocity.y -= MOVE.gravity * dt * 0.5;
      this.airAccelerate(s, wishDir, wishSpeed, MOVE.airAccelerate, dt);
      this.clampVelocity(s);
      this.flyMove(s, dt);
      s.velocity.y -= MOVE.gravity * dt * 0.5;
    }

    const wasOnGround = s.onGround;
    const fallSpeed = -s.velocity.y;
    this.categorize(s);
    if (!wasOnGround && s.onGround) {
      s.justLanded = true;
      s.landSpeed = fallSpeed;
      s.velocity.y = 0;
    }
  }

  /** If the hull starts inside something (spawned on a surface, overlapping a player), nudge it free. */
  private unstick(s: MoveState): void {
    if (this.fits(s.origin, s.ducked)) return;
    const test = tmpA;
    for (const [dx, dy, dz] of [
      [0, 1, 0], [0, 2, 0], [0, 4, 0], [0, 8, 0], [0, 18, 0],
      [4, 0, 0], [-4, 0, 0], [0, 0, 4], [0, 0, -4],
      [8, 1, 0], [-8, 1, 0], [0, 1, 8], [0, 1, -8],
    ]) {
      test.set(s.origin.x + dx, s.origin.y + dy, s.origin.z + dz);
      if (this.fits(test, s.ducked)) {
        s.origin.copy(test);
        return;
      }
    }
  }

  private duck(s: MoveState, cmd: MoveInput, dt: number): void {
    if (cmd.duck) {
      if (s.ducked) {
        s.duckAmount = 1;
        return;
      }
      if (!s.onGround) {
        // Mid-air duck is instant and pulls the feet up, which is what makes duck-jumps reach higher boxes.
        const raised = tmpA.copy(s.origin);
        raised.y += HULL_STAND.maxs.y - HULL_DUCK.maxs.y;
        if (this.fits(raised, true)) s.origin.copy(raised);
        s.ducked = true;
        s.duckAmount = 1;
        return;
      }
      s.duckAmount = Math.min(1, s.duckAmount + dt / MOVE.duckTime);
      if (s.duckAmount >= 1) s.ducked = true;
      return;
    }

    if (s.ducked) {
      if (s.onGround) {
        if (!this.fits(s.origin, false)) return;
        s.ducked = false;
        s.duckAmount = 1;
      } else {
        // Unducking in the air drops the feet back down if there's room.
        const lowered = tmpA.copy(s.origin);
        lowered.y -= HULL_STAND.maxs.y - HULL_DUCK.maxs.y;
        if (this.fits(lowered, false)) s.origin.copy(lowered);
        else if (!this.fits(s.origin, false)) return;
        s.ducked = false;
        s.duckAmount = 0;
        return;
      }
    }
    s.duckAmount = Math.max(0, s.duckAmount - dt / MOVE.duckTime);
  }

  private jump(s: MoveState): void {
    s.onGround = false;
    s.velocity.y = MOVE.jumpSpeed;
    s.jumpPenalty = MOVE.jumpPenaltyMs;
    s.justJumped = true;
  }

  categorize(s: MoveState): void {
    if (s.velocity.y > 180) {
      s.onGround = false;
      return;
    }
    const down = tmpB.copy(s.origin);
    down.y -= 2;
    const t = this.trace(s.origin, down, s);
    if (t.fraction < 1 && t.normal.y >= 0.7) {
      s.onGround = true;
      s.groundNormal.copy(t.normal);
      if (!t.startsolid && !t.allsolid) s.origin.copy(t.endpos);
    } else {
      s.onGround = false;
    }
  }

  private friction(s: MoveState, dt: number): void {
    const v = s.velocity;
    const speed = Math.hypot(v.x, v.y, v.z);
    if (speed < 0.1) return;
    const control = speed < MOVE.stopSpeed ? MOVE.stopSpeed : speed;
    const drop = control * MOVE.friction * dt;
    const scale = Math.max(0, speed - drop) / speed;
    v.scale(scale);
  }

  private accelerate(s: MoveState, dir: Vec3, wishSpeed: number, accel: number, dt: number): void {
    const current = s.velocity.dot(dir);
    const add = wishSpeed - current;
    if (add <= 0) return;
    const accelSpeed = Math.min(accel * dt * wishSpeed, add);
    s.velocity.addScaled(dir, accelSpeed);
  }

  private airAccelerate(s: MoveState, dir: Vec3, wishSpeed: number, accel: number, dt: number): void {
    // The 30 u/s cap on the projected speed is what makes air strafing gain speed.
    const wishSpd = Math.min(wishSpeed, 30);
    const current = s.velocity.dot(dir);
    const add = wishSpd - current;
    if (add <= 0) return;
    const accelSpeed = Math.min(accel * wishSpeed * dt, add);
    s.velocity.addScaled(dir, accelSpeed);
  }

  private clampVelocity(s: MoveState): void {
    const m = MOVE.maxVelocity;
    s.velocity.set(
      Math.max(-m, Math.min(m, s.velocity.x)),
      Math.max(-m, Math.min(m, s.velocity.y)),
      Math.max(-m, Math.min(m, s.velocity.z)),
    );
  }

  private walkMove(s: MoveState, dt: number): void {
    const dest = tmpA.copy(s.origin).addScaled(s.velocity, dt);
    const t = this.trace(s.origin, dest, s);
    if (t.fraction === 1) {
      s.origin.copy(t.endpos);
      return;
    }

    const original = s.origin.clone();
    const originalVel = s.velocity.clone();

    this.flyMove(s, dt);
    const downPos = s.origin.clone();
    const downVel = s.velocity.clone();

    s.origin.copy(original);
    s.velocity.copy(originalVel);

    const up = tmpA.copy(s.origin);
    up.y += MOVE.stepSize;
    let st = this.trace(s.origin, up, s);
    if (!st.startsolid && !st.allsolid) s.origin.copy(st.endpos);

    this.flyMove(s, dt);

    const down = tmpA.copy(s.origin);
    down.y -= MOVE.stepSize;
    st = this.trace(s.origin, down, s);
    if (st.fraction < 1 && st.normal.y < 0.7) {
      s.origin.copy(downPos);
      s.velocity.copy(downVel);
      return;
    }
    if (!st.startsolid && !st.allsolid) s.origin.copy(st.endpos);

    const downDist = Math.hypot(downPos.x - original.x, downPos.z - original.z);
    const upDist = Math.hypot(s.origin.x - original.x, s.origin.z - original.z);
    if (downDist > upDist) {
      s.origin.copy(downPos);
      s.velocity.copy(downVel);
    } else {
      s.velocity.y = downVel.y;
    }
  }

  private flyMove(s: MoveState, dt: number): void {
    const primal = s.velocity.clone();
    const originalVel = s.velocity.clone();
    let numPlanes = 0;
    let timeLeft = dt;
    let allFraction = 0;

    for (let bump = 0; bump < 4; bump++) {
      if (s.velocity.x === 0 && s.velocity.y === 0 && s.velocity.z === 0) break;
      const end = tmpB.copy(s.origin).addScaled(s.velocity, timeLeft);
      const t = this.trace(s.origin, end, s);
      allFraction += t.fraction;
      if (t.allsolid) {
        s.velocity.set(0, 0, 0);
        return;
      }
      if (t.fraction > 0) {
        s.origin.copy(t.endpos);
        originalVel.copy(s.velocity);
        numPlanes = 0;
      }
      if (t.fraction === 1) break;
      timeLeft -= timeLeft * t.fraction;
      if (numPlanes >= planes.length) {
        s.velocity.set(0, 0, 0);
        break;
      }
      planes[numPlanes++].copy(t.normal);

      let i = 0;
      for (; i < numPlanes; i++) {
        clipVelocity(originalVel, planes[i], s.velocity);
        let j = 0;
        for (; j < numPlanes; j++) {
          if (j !== i && s.velocity.dot(planes[j]) < 0) break;
        }
        if (j === numPlanes) break;
      }
      if (i === numPlanes) {
        if (numPlanes !== 2) {
          s.velocity.set(0, 0, 0);
          break;
        }
        // Slide along the crease between the two planes.
        const a = planes[0];
        const b = planes[1];
        const dir = new Vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
        const d = dir.dot(s.velocity);
        s.velocity.copy(dir).scale(d);
      }
      if (s.velocity.dot(primal) <= 0) {
        s.velocity.set(0, 0, 0);
        break;
      }
    }
    if (allFraction === 0) s.velocity.set(0, 0, 0);
  }
}

function clipVelocity(v: Vec3, normal: Vec3, out: Vec3): void {
  const backoff = v.dot(normal);
  out.set(v.x - normal.x * backoff, v.y - normal.y * backoff, v.z - normal.z * backoff);
  if (Math.abs(out.x) < 0.1) out.x = 0;
  if (Math.abs(out.y) < 0.1) out.y = 0;
  if (Math.abs(out.z) < 0.1) out.z = 0;
}
