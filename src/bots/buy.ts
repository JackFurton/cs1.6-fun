import type { BuyItem, GameMode } from '../game/mode';
import type { Player } from '../game/player';

const RIFLE = { T: 'ak47', CT: 'm4a1' } as const;
const CHEAP_RIFLE = { T: 'galil', CT: 'famas' } as const;
const SMG = { T: 'mac10', CT: 'mp5' } as const;

/**
 * Round-start shopping. `teamEco` is true when the team as a whole can't afford a full buy,
 * so everyone saves together instead of half the team buying.
 */
export function botBuy(p: Player, mode: GameMode, opts: { pistolRound: boolean; teamEco: boolean; lossStreak: number; teamHasAwp: boolean; rand: () => number }): void {
  const r = opts.rand;
  const buy = (item: BuyItem) => mode.buy(p, item) === null;
  const armor = () => {
    if (p.money >= 1000 && !(p.armor >= 100 && p.helmet)) buy('vesthelm');
    else if (p.money >= 650 && p.armor < 100) buy('vest');
  };
  const nades = () => {
    if (p.money >= 300 && r() < 0.6) buy('hegrenade');
    if (p.money >= 200 && r() < 0.6) buy('flashbang');
    if (p.money >= 300 && r() < 0.4) buy('smokegrenade');
  };
  const kit = () => {
    if (p.team === 'CT' && !p.defuser && p.money >= 200 && r() < 0.6) buy('defuser');
  };

  if (opts.pistolRound) {
    const x = r();
    if (x < 0.55) buy('vest');
    else if (x < 0.8) buy(p.team === 'T' ? 'deagle' : r() < 0.5 ? 'deagle' : 'p228');
    kit();
    return;
  }

  // Already armed from surviving: top up and go.
  if (p.weapons.primary) {
    armor();
    kit();
    nades();
    return;
  }

  const t = p.team;
  const rifleCost = t === 'T' ? 2500 : 3100;
  if (p.money >= 5750 && !opts.teamHasAwp && r() < 0.25) {
    buy('awp');
    armor();
    kit();
    return;
  }
  if (p.money >= rifleCost + 650) {
    buy(RIFLE[t]);
    armor();
    kit();
    nades();
    return;
  }
  if (opts.teamEco && opts.lossStreak < 3) {
    // Save, maybe a pistol upgrade if it doesn't hurt next round.
    if (p.money >= 2800 && r() < 0.4) buy('deagle');
    return;
  }
  // Force buy.
  if (p.money >= 2000 + 650) {
    buy(r() < 0.5 ? CHEAP_RIFLE[t] : SMG[t]);
    armor();
  } else if (p.money >= 1400 + 650) {
    buy(SMG[t]);
    armor();
  } else if (p.money >= 650) {
    buy('vest');
  }
  kit();
}
