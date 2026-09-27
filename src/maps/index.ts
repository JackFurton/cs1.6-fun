import { aimArena } from './aim_arena';
import { deCache } from './de_cache';
import { deDust2 } from './de_dust2';
import type { MapData } from './types';

export const MAPS: Record<string, () => MapData> = {
  de_dust2: deDust2,
  de_cache: deCache,
  aim_arena: aimArena,
};
