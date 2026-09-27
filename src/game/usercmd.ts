import type { Slot } from './weapons';

export interface UserCmd {
  forward: number;
  side: number;
  yaw: number;
  pitch: number;
  jump: boolean;
  duck: boolean;
  walk: boolean;
  attack: boolean;
  attack2: boolean;
  reload: boolean;
  use: boolean;
  /** One-shot requests, cleared once the game handles them. */
  slot: Slot | null;
  drop: boolean;
}

export function emptyCmd(): UserCmd {
  return { forward: 0, side: 0, yaw: 0, pitch: 0, jump: false, duck: false, walk: false, attack: false, attack2: false, reload: false, use: false, slot: null, drop: false };
}
