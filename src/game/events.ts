import type { Vec3 } from '../engine/vec';
import type { HitGroup } from './hitbox';
import type { Player } from './player';
import type { WeaponId } from './weapons';

export type GameEvent =
  | { type: 'shot'; player: Player; weapon: WeaponId; silenced: boolean; origin: Vec3; end: Vec3 }
  | { type: 'impact'; pos: Vec3; normal: Vec3; tex: string }
  | { type: 'blood'; pos: Vec3; dir: Vec3 }
  | { type: 'hurt'; victim: Player; attacker: Player | null; amount: number; group: HitGroup | null; dir: Vec3 }
  | { type: 'kill'; killer: Player | null; victim: Player; weapon: WeaponId | 'world'; headshot: boolean; wallbang: boolean }
  | { type: 'knife'; player: Player; hit: 'none' | 'wall' | 'player'; stab: boolean }
  | { type: 'reload'; player: Player; weapon: WeaponId }
  | { type: 'draw'; player: Player; weapon: WeaponId }
  | { type: 'empty'; player: Player }
  | { type: 'zoom'; player: Player }
  | { type: 'silencer'; player: Player; on: boolean }
  | { type: 'step'; player: Player; land: boolean }
  | { type: 'jump'; player: Player }
  | { type: 'pickup'; player: Player; weapon: WeaponId }
  | { type: 'message'; text: string; color?: string }
  | { type: 'sound'; name: string; pos: Vec3 | null };
