import { CollisionWorld } from '../engine/trace';
import { Vec3, pitchTo, yawTo } from '../engine/vec';
import { simulateThrow, solveThrow, type GrenadeId } from '../game/grenades';

export interface Lineup {
  yaw: number;
  pitch: number;
  land: Vec3;
  /** How far from the target it lands (after the visibility penalty for flashes). */
  err: number;
}

const ACCEPT: Record<GrenadeId, number> = { smokegrenade: 160, hegrenade: 220, flashbang: 400 };

/**
 * Find a yaw/pitch that puts a grenade from `eye` onto `target`, by simulating the real throw
 * (bounces and all) over a coarse grid and refining around the best few. What a player does
 * when they learn a lineup; returns null if nothing gets close enough.
 */
export function findLineup(world: CollisionWorld, id: GrenadeId, eye: Vec3, target: Vec3): Lineup | null {
  const baseYaw = yawTo(eye, target);
  const score = (yaw: number, pitch: number): Lineup => {
    const land = simulateThrow(world, id, eye, yaw, pitch);
    let err = Math.hypot(land.x - target.x, land.z - target.z) + Math.abs(land.y - target.y) * 0.5;
    // A flash only works if it pops where the people it's meant for can see it.
    if (id === 'flashbang' && !world.visible(land, target.clone().add(new Vec3(0, 60, 0)))) err += 600;
    return { yaw, pitch, land, err };
  };

  const coarse: Lineup[] = [];
  const guess = solveThrow(eye, target);
  const pitches = new Set<number>();
  for (let p = -25; p <= 70; p += 5) pitches.add(p);
  if (guess) for (const d of [-2, 0, 2]) pitches.add(guess.pitch + d);
  for (const dy of [-5, 0, 5]) for (const p of pitches) coarse.push(score(baseYaw + dy, p));
  coarse.sort((a, b) => a.err - b.err);

  let best = coarse[0];
  for (const c of coarse.slice(0, 3)) {
    for (let dy = -2; dy <= 2; dy += 1)
      for (let dp = -2; dp <= 2; dp += 1) {
        if (!dy && !dp) continue;
        const s = score(c.yaw + dy, c.pitch + dp);
        if (s.err < best.err) best = s;
      }
  }
  return best.err <= ACCEPT[id] ? best : null;
}

/** Point `dist` units from `from` toward `to`, for "smoke the gap between them". */
export function along(from: Vec3, to: Vec3, dist: number): Vec3 {
  const d = to.clone().sub(from);
  const len = d.length();
  return len < 1 ? from.clone() : from.clone().addScaled(d, Math.min(1, dist / len));
}

export { pitchTo };
