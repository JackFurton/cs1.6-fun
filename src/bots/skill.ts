export type Difficulty = 'easy' | 'normal' | 'hard' | 'expert';

export interface Skill {
  /** Seconds from an enemy appearing to the bot starting to fire. */
  reaction: number;
  /** Initial aim error in degrees when acquiring a target; decays over `settle` seconds. */
  aimError: number;
  settle: number;
  /** Maximum view turn rate, degrees per second. */
  turnSpeed: number;
  /** Chance of going for the head instead of the chest on a new target. */
  headChance: number;
  /** Fraction of recoil the bot pulls down against. */
  recoilComp: number;
  /** Chance of stopping (counter-strafing) before shooting. */
  stopToShoot: number;
  /** How well it bursts at range instead of spraying. */
  burstDiscipline: number;
  /** Multiplier on hearing radius. */
  hearing: number;
  /** Half-angle of the view cone for spotting, degrees. */
  fov: number;
  /** Chance of ADAD strafing between bursts. */
  strafe: number;
  /** Chance of crouching while spraying. */
  crouch: number;
  /** How loose the trigger finger is: multiplier on the aim window for firing. */
  sloppy: number;
}

// Normal is meant to feel like a Silver, hard like Gold Nova, expert like a solid MG.
export const SKILLS: Record<Difficulty, Skill> = {
  easy: { reaction: 0.5, aimError: 8, settle: 0.55, turnSpeed: 200, headChance: 0.08, recoilComp: 0.1, stopToShoot: 0.25, burstDiscipline: 0.15, hearing: 0.6, fov: 55, strafe: 0.05, crouch: 0.45, sloppy: 3 },
  normal: { reaction: 0.34, aimError: 5, settle: 0.38, turnSpeed: 340, headChance: 0.2, recoilComp: 0.4, stopToShoot: 0.55, burstDiscipline: 0.45, hearing: 0.85, fov: 62, strafe: 0.3, crouch: 0.35, sloppy: 2 },
  hard: { reaction: 0.25, aimError: 3.2, settle: 0.27, turnSpeed: 520, headChance: 0.35, recoilComp: 0.62, stopToShoot: 0.8, burstDiscipline: 0.75, hearing: 1, fov: 68, strafe: 0.55, crouch: 0.3, sloppy: 1.5 },
  expert: { reaction: 0.18, aimError: 2, settle: 0.19, turnSpeed: 800, headChance: 0.55, recoilComp: 0.82, stopToShoot: 0.95, burstDiscipline: 0.9, hearing: 1.1, fov: 74, strafe: 0.75, crouch: 0.2, sloppy: 1.2 },
};
