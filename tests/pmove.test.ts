import { describe, expect, test } from 'vitest';
import { boxBrush, rampBrush } from '../src/engine/brush';
import { MOVE, MoveState, PlayerMover, fallDamage, type MoveInput } from '../src/engine/pmove';
import { CollisionWorld } from '../src/engine/trace';
import { Vec3 } from '../src/engine/vec';

const DT = 1 / 100;
const v = (x: number, y: number, z: number) => new Vec3(x, y, z);

function world() {
  return new CollisionWorld([
    boxBrush(v(-4096, -16, -4096), v(4096, 0, 4096), 'floor'),
    boxBrush(v(-64, 0, -600), v(64, 18, -500), 'step18'),
    boxBrush(v(200, 0, -600), v(328, 19, -500), 'step19'),
    boxBrush(v(-1000, 0, 300), v(1000, 200, 332), 'wall'),
    rampBrush(v(600, 0, -200), v(856, 128, 200), '+x', 'ramp'),
    boxBrush(v(-1200, 0, -1200), v(-1100, 56, -1100), 'crate56'),
  ]);
}

function input(p: Partial<MoveInput> = {}): MoveInput {
  return { forward: 0, side: 0, yaw: 0, jump: false, duck: false, walk: false, ...p };
}

function spawn(m: PlayerMover, x = 0, y = 0, z = 0) {
  const s = new MoveState();
  s.origin.set(x, y + 1, z);
  m.categorize(s);
  return s;
}

function run(m: PlayerMover, s: MoveState, cmd: MoveInput, ticks: number, maxSpeed = 250) {
  for (let i = 0; i < ticks; i++) m.move(s, cmd, maxSpeed, DT);
}

describe('pmove', () => {
  test('lands on the floor', () => {
    const m = new PlayerMover(world());
    const s = new MoveState();
    s.origin.set(0, 100, 0);
    run(m, s, input(), 200);
    expect(s.onGround).toBe(true);
    expect(s.origin.y).toBeCloseTo(0, 1);
  });

  test('ground speed caps at weapon max speed', () => {
    const m = new PlayerMover(world());
    const s = spawn(m);
    run(m, s, input({ forward: 1 }), 150, 221);
    expect(s.velocity.length2d()).toBeCloseTo(221, 0);
    // yaw 0 moves toward -z
    expect(s.origin.z).toBeLessThan(-100);
  });

  test('walk and duck scale speed', () => {
    const m = new PlayerMover(world());
    const walking = spawn(m, 2000, 0, 2000);
    run(m, walking, input({ forward: 1, walk: true }), 150);
    expect(walking.velocity.length2d()).toBeCloseTo(250 * MOVE.walkMultiplier, 0);
    const ducking = spawn(m, -2000, 0, 2000);
    run(m, ducking, input({ forward: 1, duck: true }), 150);
    expect(ducking.ducked).toBe(true);
    expect(ducking.velocity.length2d()).toBeCloseTo(250 * MOVE.duckMultiplier, 0);
  });

  test('friction stops the player', () => {
    const m = new PlayerMover(world());
    const s = spawn(m);
    run(m, s, input({ forward: 1 }), 100);
    run(m, s, input(), 80);
    expect(s.velocity.length2d()).toBeLessThan(1);
  });

  test('jump reaches about 45 units and needs a re-press', () => {
    const m = new PlayerMover(world());
    const s = spawn(m);
    let peak = 0;
    let jumps = 0;
    for (let i = 0; i < 300; i++) {
      m.move(s, input({ jump: true }), 250, DT);
      if (s.justJumped) jumps++;
      peak = Math.max(peak, s.origin.y);
    }
    expect(jumps).toBe(1);
    expect(peak).toBeGreaterThan(43);
    expect(peak).toBeLessThan(46);
  });

  test('steps up 18 units but not 19', () => {
    const m = new PlayerMover(world());
    const a = spawn(m, 0, 0, -400);
    run(m, a, input({ forward: 1 }), 100);
    expect(a.origin.y).toBeCloseTo(18, 0);
    const b = spawn(m, 264, 0, -400);
    run(m, b, input({ forward: 1 }), 100);
    expect(b.origin.y).toBeCloseTo(0, 0);
    expect(b.origin.z).toBeGreaterThan(-500 + 16 - 0.1);
  });

  test('wall blocks and slides', () => {
    const m = new PlayerMover(world());
    const s = spawn(m, 0, 0, 200);
    // yaw 180 faces +z, strafing right at the same time
    run(m, s, input({ forward: 1, side: 1, yaw: 180 }), 200);
    expect(s.origin.z).toBeLessThanOrEqual(300 - 16);
    expect(s.origin.z).toBeGreaterThan(300 - 17);
    expect(s.origin.x).toBeLessThan(-200);
  });

  test('walks up a ramp', () => {
    const m = new PlayerMover(world());
    const s = spawn(m, 500, 0, 0);
    // yaw -90 faces +x
    run(m, s, input({ forward: 1, yaw: -90 }), 150);
    expect(s.origin.y).toBeGreaterThan(100);
    expect(s.onGround).toBe(true);
  });

  test('landing right after a jump slows you (1.6 bhop penalty)', () => {
    const m = new PlayerMover(world());
    const s = spawn(m, -3000, 0, 0);
    run(m, s, input({ forward: 1 }), 150);
    m.move(s, input({ forward: 1, jump: true }), 250, DT);
    let landed = false;
    for (let i = 0; i < 200 && !landed; i++) {
      m.move(s, input({ forward: 1 }), 250, DT);
      landed = s.justLanded;
    }
    expect(landed).toBe(true);
    run(m, s, input({ forward: 1 }), 10);
    expect(s.velocity.length2d()).toBeLessThan(200);
    run(m, s, input({ forward: 1 }), 150);
    expect(s.velocity.length2d()).toBeCloseTo(250, 0);
  });

  test('air strafing gains speed', () => {
    const m = new PlayerMover(world());
    const s = new MoveState();
    s.origin.set(0, 2000, -2000);
    s.velocity.set(0, 0, -250);
    let yaw = 0;
    for (let i = 0; i < 60; i++) {
      yaw += 1.5; // turning left while holding strafe-left
      m.move(s, input({ side: -1, yaw }), 250, DT);
    }
    expect(s.velocity.length2d()).toBeGreaterThan(270);
  });

  test('duck-jump clears a 56 unit crate, plain jump does not', () => {
    const m = new PlayerMover(world());
    const tryJump = (duck: boolean) => {
      const s = spawn(m, -1150, 0, -1000);
      s.velocity.set(0, 0, -200);
      for (let i = 0; i < 150; i++) m.move(s, input({ forward: 1, jump: i < 2, duck: duck && i > 5 }), 200, DT);
      return s.origin.y;
    };
    expect(tryJump(false)).toBeCloseTo(0, 0);
    expect(tryJump(true)).toBeCloseTo(56, 0);
  });

  test('fall damage', () => {
    expect(fallDamage(500)).toBe(0);
    expect(fallDamage(1024)).toBeCloseTo(100);
  });
});
