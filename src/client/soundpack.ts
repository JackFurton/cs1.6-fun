import type { WeaponId } from '../game/weapons';

/**
 * Where each sound lives in a CS 1.6 install's cstrike/sound folder. Copy that folder to
 * public/sounds/cstrike/ and the game plays the originals; anything missing is synthesized.
 * Several files for one key are picked at random, like the game does.
 */
const GUN: Partial<Record<WeaponId, string[]>> = {
  glock: ['weapons/glock18-1.wav', 'weapons/glock18-2.wav'],
  usp: ['weapons/usp_unsil-1.wav'],
  p228: ['weapons/p228-1.wav'],
  deagle: ['weapons/deagle-1.wav', 'weapons/deagle-2.wav'],
  fiveseven: ['weapons/fiveseven-1.wav'],
  elite: ['weapons/elite_fire.wav'],
  m3: ['weapons/m3-1.wav'],
  xm1014: ['weapons/xm1014-1.wav'],
  mac10: ['weapons/mac10-1.wav'],
  tmp: ['weapons/tmp-1.wav', 'weapons/tmp-2.wav'],
  mp5: ['weapons/mp5-1.wav', 'weapons/mp5-2.wav'],
  ump45: ['weapons/ump45-1.wav'],
  p90: ['weapons/p90-1.wav'],
  galil: ['weapons/galil-1.wav', 'weapons/galil-2.wav'],
  famas: ['weapons/famas-1.wav', 'weapons/famas-2.wav'],
  ak47: ['weapons/ak47-1.wav', 'weapons/ak47-2.wav'],
  m4a1: ['weapons/m4a1_unsil-1.wav', 'weapons/m4a1_unsil-2.wav'],
  sg552: ['weapons/sg552-1.wav', 'weapons/sg552-2.wav'],
  aug: ['weapons/aug-1.wav'],
  scout: ['weapons/scout_fire-1.wav'],
  awp: ['weapons/awp1.wav'],
  g3sg1: ['weapons/g3sg1-1.wav'],
  sg550: ['weapons/sg550-1.wav'],
  m249: ['weapons/m249-1.wav', 'weapons/m249-2.wav'],
};

const SILENCED: Partial<Record<WeaponId, string[]>> = {
  usp: ['weapons/usp1.wav', 'weapons/usp2.wav'],
  m4a1: ['weapons/m4a1-1.wav'],
};

const n = (base: string, count: number) => Array.from({ length: count }, (_, i) => `${base}${i + 1}.wav`);

export const SOUND_FILES = {
  gun: GUN,
  silenced: SILENCED,
  step: {
    concrete: n('player/pl_step', 4),
    dirt: n('player/pl_dirt', 4),
    metal: n('player/pl_metal', 4),
    tile: n('player/pl_tile', 4),
    wood: n('player/pl_duct', 4),
    snow: n('player/pl_snow', 6),
  },
  hit: {
    flesh: ['player/bhit_flesh-1.wav', 'player/bhit_flesh-2.wav', 'player/bhit_flesh-3.wav'],
    kevlar: ['player/bhit_kevlar-1.wav'],
    helmet: ['player/bhit_helmet-1.wav'],
    headshot: ['player/headshot1.wav', 'player/headshot2.wav', 'player/headshot3.wav'],
  },
  knife: {
    slash: ['weapons/knife_slash1.wav', 'weapons/knife_slash2.wav'],
    hit: ['weapons/knife_hit1.wav', 'weapons/knife_hit2.wav', 'weapons/knife_hit3.wav', 'weapons/knife_hit4.wav'],
    wall: ['weapons/knife_hitwall1.wav'],
    stab: ['weapons/knife_stab.wav'],
  },
  ric: n('weapons/ric', 5),
  c4: { beep: ['weapons/c4_beep1.wav'], plant: ['weapons/c4_plant.wav'], explode: ['weapons/c4_explode1.wav'], defuse: ['weapons/c4_disarm.wav'] },
  he: ['weapons/hegrenade-1.wav', 'weapons/hegrenade-2.wav'],
  flash: ['weapons/flashbang-1.wav', 'weapons/flashbang-2.wav'],
  smoke: ['weapons/sg_explode.wav'],
  bounce: ['weapons/he_bounce-1.wav', 'weapons/grenade_hit1.wav'],
  zoom: ['weapons/zoom.wav'],
  empty: ['weapons/dryfire_rifle.wav'],
  draw: ['items/gunpickup2.wav'],
  radio: {
    go: ['radio/go.wav', 'radio/moveout.wav', 'radio/letsgo.wav', 'radio/locknload.wav'],
    planted: ['radio/bombpl.wav'],
    defused: ['radio/bombdef.wav'],
    ctwin: ['radio/ctwin.wav'],
    terwin: ['radio/terwin.wav'],
    draw: ['radio/rounddraw.wav'],
    spotted: ['radio/enemys.wav'],
    fireinhole: ['radio/ct_fireinhole.wav', 'radio/fireinhole.wav'],
    rotate: ['radio/fallback.wav'],
  },
};

/** Paths look like "weapons/ak47-1.wav" relative to sounds/cstrike/. */
export const PACK_ROOT = 'sounds/cstrike/';
