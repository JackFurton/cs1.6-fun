import { aimArena } from './aim_arena';
import { deCache } from './de_cache';
import { deDust2 } from './de_dust2';
import { deHarbor } from './de_harbor';
import { deInferno } from './de_inferno';
import { deMirage } from './de_mirage';
import { fyIceworld } from './fy_iceworld';
import type { MapData } from './types';

export const MAPS: Record<string, () => MapData> = {
  de_dust2: deDust2,
  de_mirage: deMirage,
  de_inferno: deInferno,
  de_cache: deCache,
  de_harbor: deHarbor,
  fy_iceworld: fyIceworld,
  aim_arena: aimArena,
};
