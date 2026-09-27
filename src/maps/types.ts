import type { Brush } from '../engine/brush';
import type { Vec3 } from '../engine/vec';

export type Team = 'T' | 'CT';

export interface Spawn {
  pos: Vec3;
  yaw: number;
}

export interface Zone {
  name: string;
  min: Vec3;
  max: Vec3;
}

export interface MapData {
  name: string;
  brushes: Brush[];
  spawns: Record<Team, Spawn[]>;
  bombsites: Zone[];
  buyzones: Record<Team, Zone[]>;
  /** Named areas for the radar and bot callouts. */
  callouts: Zone[];
  sky: { top: number; horizon: number };
  sun: { dir: [number, number, number]; color: number; intensity: number };
  ambient: number;
}

export function inZone(z: Zone, p: Vec3): boolean {
  return p.x >= z.min.x && p.x <= z.max.x && p.y >= z.min.y && p.y <= z.max.y && p.z >= z.min.z && p.z <= z.max.z;
}
