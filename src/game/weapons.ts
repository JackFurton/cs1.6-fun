// Weapon numbers follow CS 1.6 (dlls/wpn_shared/*.cpp) where known, otherwise tuned to match its feel.
import type { Team } from '../maps/types';

export type WeaponId =
  | 'knife'
  | 'glock'
  | 'usp'
  | 'p228'
  | 'deagle'
  | 'fiveseven'
  | 'elite'
  | 'm3'
  | 'xm1014'
  | 'mac10'
  | 'tmp'
  | 'mp5'
  | 'ump45'
  | 'p90'
  | 'galil'
  | 'famas'
  | 'ak47'
  | 'm4a1'
  | 'sg552'
  | 'aug'
  | 'scout'
  | 'awp'
  | 'g3sg1'
  | 'sg550'
  | 'm249'
  | 'hegrenade'
  | 'flashbang'
  | 'smokegrenade'
  | 'c4'
  | 'silencer';

export type Slot = 'primary' | 'secondary' | 'knife' | 'grenade' | 'c4';

/** KickBack(up_base, lateral_base, up_mod, lateral_mod, up_max, lateral_max, direction_change). */
export type Kick = [number, number, number, number, number, number, number];

/** Spread as base + mult * accuracy, per movement state. */
export interface SpreadTable {
  air: [number, number];
  move: [number, number];
  duck: [number, number];
  stand: [number, number];
  /** Horizontal speed above which "move" applies. */
  moveSpeed: number;
}

export type Accuracy =
  /** Rifles/SMGs: accuracy = shots^exp / div + offset, capped. Higher is worse. */
  | { kind: 'shots'; exp: number; div: number; offset: number; max: number; first: number }
  /** Pistols: accuracy recovers with time between shots. Higher is better; spread scales by (1 - acc). */
  | { kind: 'time'; recover: number; penalty: number; min: number; max: number }
  /** Snipers and shotguns: fixed spread per state. */
  | { kind: 'fixed' };

export interface WeaponDef {
  id: WeaponId;
  name: string;
  slot: Slot;
  price: number;
  team?: Team;
  damage: number;
  /** Damage multiplier per 500 units travelled. */
  rangeModifier: number;
  /** Units of wall a bullet can punch through (0 = none). */
  penetration: number;
  /** Fraction of damage that goes through kevlar. */
  armorPen: number;
  cycle: number;
  auto: boolean;
  clip: number;
  reserve: number;
  reload: number;
  /** Shotguns reload one shell at a time. */
  shellReload?: number;
  deploy: number;
  speed: number;
  pellets?: number;
  spread: SpreadTable;
  accuracy: Accuracy;
  kick?: { move: Kick; air: Kick; duck: Kick; stand: Kick };
  /** Fixed upward punch per shot for semi-autos (degrees). */
  punch?: number;
  /** Zoom FOVs (4:3 horizontal) for each scope level. */
  zoom?: number[];
  scopedSpeed?: number;
  /** Extra spread when a sniper fires unscoped. */
  unscopedSpread?: number;
  alt?: 'silencer' | 'burst' | 'zoom' | 'target';
  /** Loudness radius for bots and positional audio. */
  loudness: number;
  range: number;
}

const k = (...v: Kick): Kick => v;
const sp = (air: [number, number], move: [number, number], duck: [number, number], stand: [number, number], moveSpeed = 140): SpreadTable => ({ air, move, duck, stand, moveSpeed });

const PISTOL = { slot: 'secondary' as const, auto: false, deploy: 0.75, speed: 250, range: 4096, loudness: 1200 };
const RIFLE = { slot: 'primary' as const, auto: true, deploy: 1.0, range: 8192, loudness: 2000 };

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  silencer: {
    id: 'silencer', name: 'Silencer · Nuke', slot: 'primary', price: 800,
    damage: 0, rangeModifier: 1, penetration: 0, armorPen: 1,
    cycle: 1, auto: false, clip: 1, reserve: 0, reload: 0, deploy: 0.8, speed: 230,
    spread: sp([0, 0], [0, 0], [0, 0], [0, 0]), accuracy: { kind: 'fixed' },
    alt: 'target', loudness: 0, range: 0,
  },
  knife: {
    id: 'knife',
    name: 'Knife',
    slot: 'knife',
    price: 0,
    damage: 15,
    rangeModifier: 1,
    penetration: 0,
    armorPen: 0.85,
    cycle: 0.4,
    auto: true,
    clip: -1,
    reserve: 0,
    reload: 0,
    deploy: 0.5,
    speed: 250,
    spread: sp([0, 0], [0, 0], [0, 0], [0, 0]),
    accuracy: { kind: 'fixed' },
    loudness: 300,
    range: 48,
  },
  glock: {
    ...PISTOL,
    id: 'glock',
    name: 'Glock-18',
    price: 400,
    damage: 25,
    rangeModifier: 0.75,
    penetration: 21,
    armorPen: 0.47,
    cycle: 0.15,
    clip: 20,
    reserve: 120,
    reload: 2.2,
    spread: sp([1, 0], [0.165, 0], [0.095, 0], [0.1, 0], 0),
    accuracy: { kind: 'time', recover: 0.325, penalty: 0.275, min: 0.6, max: 0.9 },
    punch: 2,
    alt: 'burst',
  },
  usp: {
    ...PISTOL,
    id: 'usp',
    name: 'USP',
    price: 500,
    damage: 34,
    rangeModifier: 0.79,
    penetration: 21,
    armorPen: 0.505,
    cycle: 0.15,
    clip: 12,
    reserve: 100,
    reload: 2.7,
    spread: sp([1.2, 0], [0.225, 0], [0.08, 0], [0.1, 0], 0),
    accuracy: { kind: 'time', recover: 0.3, penalty: 0.275, min: 0.6, max: 0.92 },
    punch: 2,
    alt: 'silencer',
  },
  p228: {
    ...PISTOL,
    id: 'p228',
    name: 'P228',
    price: 600,
    damage: 32,
    rangeModifier: 0.8,
    penetration: 25,
    armorPen: 0.62,
    cycle: 0.15,
    clip: 13,
    reserve: 52,
    reload: 2.7,
    spread: sp([1.5, 0], [0.255, 0], [0.075, 0], [0.15, 0], 0),
    accuracy: { kind: 'time', recover: 0.325, penalty: 0.3, min: 0.6, max: 0.9 },
    punch: 2,
  },
  deagle: {
    ...PISTOL,
    id: 'deagle',
    name: 'Desert Eagle',
    price: 650,
    damage: 54,
    rangeModifier: 0.81,
    penetration: 30,
    armorPen: 0.93,
    cycle: 0.225,
    clip: 7,
    reserve: 35,
    reload: 2.2,
    spread: sp([1.5, 0], [0.25, 0], [0.115, 0], [0.13, 0], 0),
    accuracy: { kind: 'time', recover: 0.4, penalty: 0.35, min: 0.55, max: 0.9 },
    punch: 2,
    loudness: 1800,
  },
  fiveseven: {
    ...PISTOL,
    id: 'fiveseven',
    name: 'Five-SeveN',
    price: 750,
    team: 'CT',
    damage: 20,
    rangeModifier: 0.885,
    penetration: 30,
    armorPen: 0.75,
    cycle: 0.15,
    clip: 20,
    reserve: 100,
    reload: 2.7,
    spread: sp([1.5, 0], [0.255, 0], [0.075, 0], [0.15, 0], 0),
    accuracy: { kind: 'time', recover: 0.275, penalty: 0.25, min: 0.725, max: 0.92 },
    punch: 2,
  },
  elite: {
    ...PISTOL,
    id: 'elite',
    name: 'Dual Elites',
    price: 800,
    team: 'T',
    damage: 36,
    rangeModifier: 0.75,
    penetration: 21,
    armorPen: 0.575,
    cycle: 0.12,
    clip: 30,
    reserve: 120,
    reload: 4.5,
    spread: sp([1.3, 0], [0.175, 0], [0.08, 0], [0.1, 0], 0),
    accuracy: { kind: 'time', recover: 0.325, penalty: 0.275, min: 0.55, max: 0.88 },
    punch: 2,
  },
  m3: {
    id: 'm3',
    name: 'M3 Super 90',
    slot: 'primary',
    price: 1700,
    damage: 20,
    pellets: 9,
    rangeModifier: 0.5,
    penetration: 0,
    armorPen: 0.5,
    cycle: 0.875,
    auto: false,
    clip: 8,
    reserve: 32,
    reload: 0.55,
    shellReload: 0.45,
    deploy: 1.0,
    speed: 230,
    spread: sp([0.0675, 0], [0.0675, 0], [0.0675, 0], [0.0675, 0]),
    accuracy: { kind: 'fixed' },
    punch: 5,
    loudness: 2000,
    range: 3000,
  },
  xm1014: {
    id: 'xm1014',
    name: 'XM1014',
    slot: 'primary',
    price: 3000,
    damage: 20,
    pellets: 6,
    rangeModifier: 0.5,
    penetration: 0,
    armorPen: 0.5,
    cycle: 0.25,
    auto: true,
    clip: 7,
    reserve: 32,
    reload: 0.55,
    shellReload: 0.3,
    deploy: 1.0,
    speed: 240,
    spread: sp([0.0725, 0], [0.0725, 0], [0.0725, 0], [0.0725, 0]),
    accuracy: { kind: 'fixed' },
    punch: 3.5,
    loudness: 2000,
    range: 3048,
  },
  mac10: {
    ...RIFLE,
    id: 'mac10',
    name: 'MAC-10',
    price: 1400,
    team: 'T',
    damage: 29,
    rangeModifier: 0.82,
    penetration: 15,
    armorPen: 0.95,
    cycle: 0.07,
    clip: 30,
    reserve: 100,
    reload: 3.15,
    speed: 250,
    spread: sp([0, 0.375], [0, 0.03], [0, 0.03], [0, 0.03]),
    accuracy: { kind: 'shots', exp: 3, div: 200, offset: 0.6, max: 1.65, first: 0.15 },
    kick: {
      move: k(0.9, 0.45, 0.25, 0.035, 3.5, 2.75, 7),
      air: k(1.3, 0.55, 0.4, 0.05, 4.75, 3.75, 5),
      duck: k(0.75, 0.4, 0.175, 0.03, 2.75, 2.5, 10),
      stand: k(0.775, 0.425, 0.2, 0.03, 3, 2.75, 9),
    },
    loudness: 1400,
  },
  tmp: {
    ...RIFLE,
    id: 'tmp',
    name: 'TMP',
    price: 1250,
    team: 'CT',
    damage: 20,
    rangeModifier: 0.85,
    penetration: 21,
    armorPen: 0.7,
    cycle: 0.07,
    clip: 30,
    reserve: 120,
    reload: 2.1,
    speed: 250,
    spread: sp([0, 0.25], [0, 0.03], [0, 0.03], [0, 0.03]),
    accuracy: { kind: 'shots', exp: 3, div: 200, offset: 0.55, max: 1.4, first: 0.2 },
    kick: {
      move: k(0.8, 0.4, 0.2, 0.03, 3, 2.5, 7),
      air: k(1.1, 0.5, 0.35, 0.045, 4.5, 3.5, 6),
      duck: k(0.7, 0.35, 0.125, 0.025, 2.5, 2, 10),
      stand: k(0.725, 0.375, 0.175, 0.03, 2.75, 2.25, 9),
    },
    loudness: 400,
  },
  mp5: {
    ...RIFLE,
    id: 'mp5',
    name: 'MP5 Navy',
    price: 1500,
    damage: 26,
    rangeModifier: 0.84,
    penetration: 21,
    armorPen: 0.625,
    cycle: 0.075,
    clip: 30,
    reserve: 120,
    reload: 2.63,
    speed: 250,
    spread: sp([0, 0.2], [0, 0.04], [0, 0.04], [0, 0.04]),
    accuracy: { kind: 'shots', exp: 2, div: 220.1, offset: 0.45, max: 0.75, first: 0 },
    kick: {
      move: k(0.45, 0.3, 0.2, 0.0275, 4, 2.25, 10),
      air: k(0.9, 0.475, 0.35, 0.0425, 5, 3, 6),
      duck: k(0.275, 0.2, 0.125, 0.02, 3, 1, 9),
      stand: k(0.3, 0.225, 0.125, 0.02, 3.25, 1.25, 8),
    },
    loudness: 1400,
  },
  ump45: {
    ...RIFLE,
    id: 'ump45',
    name: 'UMP45',
    price: 1700,
    damage: 30,
    rangeModifier: 0.82,
    penetration: 15,
    armorPen: 0.65,
    cycle: 0.1,
    clip: 25,
    reserve: 100,
    reload: 3.5,
    speed: 250,
    spread: sp([0, 0.24], [0, 0.04], [0, 0.04], [0, 0.04]),
    accuracy: { kind: 'shots', exp: 2, div: 210, offset: 0.5, max: 1, first: 0 },
    kick: {
      move: k(0.125, 0.65, 0.55, 0.0475, 5.5, 4, 10),
      air: k(0.125, 0.65, 0.55, 0.0475, 5.5, 4, 10),
      duck: k(0.25, 0.45, 0.225, 0.03, 3.5, 2.5, 10),
      stand: k(0.3, 0.5, 0.25, 0.035, 4, 2.75, 10),
    },
    loudness: 1400,
  },
  p90: {
    ...RIFLE,
    id: 'p90',
    name: 'P90',
    price: 2350,
    damage: 21,
    rangeModifier: 0.885,
    penetration: 30,
    armorPen: 0.69,
    cycle: 0.066,
    clip: 50,
    reserve: 100,
    reload: 3.4,
    speed: 245,
    spread: sp([0, 0.3], [0, 0.115], [0, 0.045], [0, 0.045], 170),
    accuracy: { kind: 'shots', exp: 2, div: 175, offset: 0.45, max: 1, first: 0.2 },
    kick: {
      move: k(0.45, 0.3, 0.2, 0.0275, 4, 2.25, 7),
      air: k(0.9, 0.45, 0.35, 0.04, 5.25, 3.5, 4),
      duck: k(0.275, 0.2, 0.125, 0.02, 3, 1, 9),
      stand: k(0.3, 0.225, 0.125, 0.02, 3.25, 1.25, 8),
    },
    loudness: 1400,
  },
  galil: {
    ...RIFLE,
    id: 'galil',
    name: 'IDF Defender',
    price: 2000,
    team: 'T',
    damage: 30,
    rangeModifier: 0.98,
    penetration: 35,
    armorPen: 0.775,
    cycle: 0.0875,
    clip: 35,
    reserve: 90,
    reload: 2.45,
    speed: 240,
    spread: sp([0.04, 0.3], [0.04, 0.07], [0, 0.0375], [0, 0.0375]),
    accuracy: { kind: 'shots', exp: 3, div: 200, offset: 0.35, max: 1.25, first: 0.2 },
    kick: {
      move: k(1, 0.45, 0.28, 0.045, 3.75, 3, 7),
      air: k(1.2, 0.5, 0.23, 0.15, 5.5, 3.5, 6),
      duck: k(0.6, 0.3, 0.2, 0.0125, 3.25, 2, 7),
      stand: k(0.65, 0.35, 0.25, 0.015, 3.5, 2.25, 7),
    },
  },
  famas: {
    ...RIFLE,
    id: 'famas',
    name: 'FAMAS',
    price: 2250,
    team: 'CT',
    damage: 30,
    rangeModifier: 0.96,
    penetration: 35,
    armorPen: 0.7,
    cycle: 0.0825,
    clip: 25,
    reserve: 90,
    reload: 3.3,
    speed: 240,
    spread: sp([0.03, 0.3], [0.03, 0.07], [0, 0.02], [0, 0.02]),
    accuracy: { kind: 'shots', exp: 3, div: 215, offset: 0.3, max: 1, first: 0.2 },
    kick: {
      move: k(1, 0.45, 0.275, 0.05, 4, 2.5, 7),
      air: k(1.25, 0.45, 0.22, 0.18, 5.5, 4, 5),
      duck: k(0.575, 0.325, 0.2, 0.011, 3.25, 2, 8),
      stand: k(0.625, 0.375, 0.25, 0.0125, 3.5, 2.25, 8),
    },
    alt: 'burst',
  },
  ak47: {
    ...RIFLE,
    id: 'ak47',
    name: 'AK-47',
    price: 2500,
    team: 'T',
    damage: 36,
    rangeModifier: 0.98,
    penetration: 39,
    armorPen: 0.775,
    cycle: 0.0955,
    clip: 30,
    reserve: 90,
    reload: 2.45,
    speed: 221,
    spread: sp([0.04, 0.4], [0.04, 0.07], [0, 0.0275], [0, 0.0275]),
    accuracy: { kind: 'shots', exp: 3, div: 200, offset: 0.35, max: 1.25, first: 0.2 },
    kick: {
      move: k(1.5, 0.45, 0.225, 0.05, 6.5, 2.5, 7),
      air: k(2, 1, 0.5, 0.35, 9, 6, 5),
      duck: k(0.9, 0.35, 0.15, 0.025, 5.5, 1.5, 9),
      stand: k(1, 0.375, 0.175, 0.0375, 5.75, 1.75, 8),
    },
  },
  m4a1: {
    ...RIFLE,
    id: 'm4a1',
    name: 'M4A1',
    price: 3100,
    team: 'CT',
    damage: 32,
    rangeModifier: 0.97,
    penetration: 35,
    armorPen: 0.7,
    cycle: 0.0875,
    clip: 30,
    reserve: 90,
    reload: 3.05,
    speed: 230,
    spread: sp([0.035, 0.4], [0.035, 0.07], [0, 0.02], [0, 0.02]),
    accuracy: { kind: 'shots', exp: 3, div: 220, offset: 0.3, max: 1, first: 0.2 },
    kick: {
      move: k(1, 0.45, 0.28, 0.045, 3.75, 3, 7),
      air: k(1.2, 0.5, 0.23, 0.15, 5.5, 3.5, 6),
      duck: k(0.6, 0.3, 0.2, 0.0125, 3.25, 2, 7),
      stand: k(0.65, 0.35, 0.25, 0.015, 3.5, 2.25, 7),
    },
    alt: 'silencer',
  },
  sg552: {
    ...RIFLE,
    id: 'sg552',
    name: 'SG-552',
    price: 3500,
    team: 'T',
    damage: 33,
    rangeModifier: 0.955,
    penetration: 35,
    armorPen: 0.7,
    cycle: 0.0825,
    clip: 30,
    reserve: 90,
    reload: 3,
    speed: 235,
    scopedSpeed: 200,
    spread: sp([0.035, 0.45], [0.035, 0.075], [0, 0.02], [0, 0.02]),
    accuracy: { kind: 'shots', exp: 3, div: 220, offset: 0.3, max: 1, first: 0.2 },
    kick: {
      move: k(1, 0.45, 0.28, 0.04, 4.25, 2.5, 7),
      air: k(1.25, 0.45, 0.22, 0.18, 6, 4, 5),
      duck: k(0.6, 0.35, 0.2, 0.0125, 3.7, 2, 10),
      stand: k(0.625, 0.375, 0.25, 0.0125, 4, 2.25, 9),
    },
    zoom: [55],
    alt: 'zoom',
  },
  aug: {
    ...RIFLE,
    id: 'aug',
    name: 'AUG',
    price: 3500,
    team: 'CT',
    damage: 32,
    rangeModifier: 0.96,
    penetration: 35,
    armorPen: 0.7,
    cycle: 0.0825,
    clip: 30,
    reserve: 90,
    reload: 3.3,
    speed: 240,
    scopedSpeed: 200,
    spread: sp([0.035, 0.4], [0.035, 0.07], [0, 0.02], [0, 0.02]),
    accuracy: { kind: 'shots', exp: 3, div: 215, offset: 0.3, max: 1, first: 0.2 },
    kick: {
      move: k(1, 0.45, 0.275, 0.05, 4, 2.5, 7),
      air: k(1.25, 0.45, 0.22, 0.18, 5.5, 4, 5),
      duck: k(0.575, 0.325, 0.2, 0.011, 3.25, 2, 8),
      stand: k(0.625, 0.375, 0.25, 0.0125, 3.5, 2.25, 8),
    },
    zoom: [55],
    alt: 'zoom',
  },
  scout: {
    ...RIFLE,
    id: 'scout',
    name: 'Schmidt Scout',
    price: 2750,
    damage: 75,
    rangeModifier: 0.98,
    penetration: 45,
    armorPen: 0.85,
    cycle: 1.25,
    auto: false,
    clip: 10,
    reserve: 90,
    reload: 2,
    speed: 260,
    scopedSpeed: 220,
    spread: sp([0.2, 0], [0.075, 0], [0, 0], [0.007, 0], 170),
    accuracy: { kind: 'fixed' },
    unscopedSpread: 0.025,
    punch: 2,
    zoom: [40, 15],
    alt: 'zoom',
  },
  awp: {
    ...RIFLE,
    id: 'awp',
    name: 'AWP',
    price: 4750,
    damage: 115,
    rangeModifier: 0.99,
    penetration: 45,
    armorPen: 0.975,
    cycle: 1.45,
    auto: false,
    clip: 10,
    reserve: 30,
    reload: 2.5,
    deploy: 1.25,
    speed: 210,
    scopedSpeed: 150,
    spread: sp([0.85, 0], [0.25, 0], [0, 0], [0.001, 0], 10),
    accuracy: { kind: 'fixed' },
    unscopedSpread: 0.08,
    punch: 2,
    zoom: [40, 10],
    alt: 'zoom',
    loudness: 2800,
  },
  g3sg1: {
    ...RIFLE,
    id: 'g3sg1',
    name: 'G3/SG-1',
    price: 5000,
    team: 'T',
    damage: 80,
    rangeModifier: 0.98,
    penetration: 45,
    armorPen: 0.825,
    cycle: 0.25,
    auto: true,
    clip: 20,
    reserve: 90,
    reload: 3.5,
    speed: 210,
    scopedSpeed: 150,
    spread: sp([0.45, 0], [0.15, 0], [0.035, 0], [0.055, 0], 0),
    accuracy: { kind: 'fixed' },
    unscopedSpread: 0.05,
    punch: 2.25,
    zoom: [40, 15],
    alt: 'zoom',
  },
  sg550: {
    ...RIFLE,
    id: 'sg550',
    name: 'SG-550',
    price: 4200,
    team: 'CT',
    damage: 70,
    rangeModifier: 0.98,
    penetration: 45,
    armorPen: 0.725,
    cycle: 0.25,
    auto: true,
    clip: 30,
    reserve: 90,
    reload: 3.35,
    speed: 210,
    scopedSpeed: 150,
    spread: sp([0.45, 0], [0.15, 0], [0.04, 0], [0.05, 0], 0),
    accuracy: { kind: 'fixed' },
    unscopedSpread: 0.05,
    punch: 1.75,
    zoom: [40, 15],
    alt: 'zoom',
  },
  m249: {
    ...RIFLE,
    id: 'm249',
    name: 'M249',
    price: 5750,
    damage: 32,
    rangeModifier: 0.97,
    penetration: 35,
    armorPen: 0.8,
    cycle: 0.1,
    clip: 100,
    reserve: 200,
    reload: 4.7,
    speed: 220,
    spread: sp([0.045, 0.5], [0.045, 0.095], [0, 0.03], [0, 0.03]),
    accuracy: { kind: 'shots', exp: 3, div: 175, offset: 0.4, max: 0.9, first: 0.2 },
    kick: {
      move: k(1.1, 0.5, 0.3, 0.06, 4, 3, 8),
      air: k(1.8, 0.65, 0.45, 0.125, 5, 3.5, 8),
      duck: k(0.75, 0.325, 0.25, 0.025, 3.5, 2.5, 9),
      stand: k(0.8, 0.35, 0.3, 0.03, 3.75, 3, 9),
    },
  },
  hegrenade: grenade('hegrenade', 'HE Grenade', 300),
  flashbang: grenade('flashbang', 'Flashbang', 200),
  smokegrenade: grenade('smokegrenade', 'Smoke Grenade', 300),
  c4: {
    id: 'c4',
    name: 'C4',
    slot: 'c4',
    price: 0,
    damage: 0,
    rangeModifier: 1,
    penetration: 0,
    armorPen: 1,
    cycle: 0,
    auto: false,
    clip: -1,
    reserve: 0,
    reload: 0,
    deploy: 0.5,
    speed: 250,
    spread: sp([0, 0], [0, 0], [0, 0], [0, 0]),
    accuracy: { kind: 'fixed' },
    loudness: 0,
    range: 0,
  },
};

function grenade(id: WeaponId, name: string, price: number): WeaponDef {
  return {
    id,
    name,
    slot: 'grenade',
    price,
    damage: 0,
    rangeModifier: 1,
    penetration: 0,
    armorPen: 1,
    cycle: 0.5,
    auto: false,
    clip: -1,
    reserve: 0,
    reload: 0,
    deploy: 0.5,
    speed: 250,
    spread: sp([0, 0], [0, 0], [0, 0], [0, 0]),
    accuracy: { kind: 'fixed' },
    loudness: 300,
    range: 0,
  };
}

export const KILL_REWARD = 300;
