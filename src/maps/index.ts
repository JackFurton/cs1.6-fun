import { aimArena } from './aim_arena';
import type { MapData } from './types';

export const MAPS: Record<string, () => MapData> = {
  aim_arena: aimArena,
};
