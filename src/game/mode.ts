import type { Rules } from './game';
import type { Player } from './player';
import type { WeaponId } from './weapons';

export type BuyItem = WeaponId | 'vest' | 'vesthelm' | 'defuser' | 'primammo' | 'secammo';

export interface GameMode extends Rules {
  start(): void;
  canBuy(p: Player): boolean;
  buy(p: Player, item: BuyItem): string | null;
}
