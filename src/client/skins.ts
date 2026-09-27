import type { Team } from '../maps/types';

export type Headwear = 'balaclava' | 'bandana' | 'cap' | 'beret' | 'helmet' | 'gasmask';

export interface Skin {
  name: string;
  blurb: string;
  pants: number;
  shirt: number;
  vest: number;
  skin: number;
  gloves: number;
  head: Headwear;
  hat: number;
  goggles?: boolean;
  sunglasses?: boolean;
}

const SKIN_TONE = 0xc09070;

// The four 1.6 models per side, reduced to colours and headgear.
export const SKINS: Record<Team, Skin[]> = {
  T: [
    { name: 'Phoenix Connexion', blurb: 'Balaclavas and cheap jackets.', pants: 0x4a4538, shirt: 0x6b5d45, vest: 0x3e3a30, skin: SKIN_TONE, gloves: 0x2a2620, head: 'balaclava', hat: 0x1c1c1c },
    { name: 'Elite Crew', blurb: 'Jeans, shades, bandana.', pants: 0x2e3a52, shirt: 0x2c2c2c, vest: 0x1f1f1f, skin: SKIN_TONE, gloves: SKIN_TONE, head: 'bandana', hat: 0x8a2a20, sunglasses: true },
    { name: 'Arctic Avengers', blurb: 'Winter camo from the north.', pants: 0xb4b8bc, shirt: 0xcfd3d7, vest: 0x868c92, skin: SKIN_TONE, gloves: 0xdadada, head: 'cap', hat: 0x5c6064 },
    { name: 'Guerilla Warfare', blurb: 'Jungle greens and a beret.', pants: 0x4a5236, shirt: 0x5e6a40, vest: 0x3a3a28, skin: SKIN_TONE, gloves: 0x3a3a28, head: 'beret', hat: 0x2a3a1e },
  ],
  CT: [
    { name: 'SEAL Team 6', blurb: 'US Navy. Olive drab and goggles.', pants: 0x4c5238, shirt: 0x5a6040, vest: 0x33382a, skin: SKIN_TONE, gloves: 0x222222, head: 'helmet', hat: 0x3e4430, goggles: true },
    { name: 'GSG-9', blurb: 'German border police.', pants: 0x3a4a3a, shirt: 0x48584a, vest: 0x2a302a, skin: SKIN_TONE, gloves: 0x1c1c1c, head: 'helmet', hat: 0x2e3a2e },
    { name: 'SAS', blurb: 'British. All black, gas mask.', pants: 0x2a2a2e, shirt: 0x333338, vest: 0x1c1c20, skin: SKIN_TONE, gloves: 0x151515, head: 'gasmask', hat: 0x1a1a1a },
    { name: 'GIGN', blurb: 'French gendarmerie in navy.', pants: 0x1e2a44, shirt: 0x2a3858, vest: 0x151c2c, skin: SKIN_TONE, gloves: 0x111111, head: 'helmet', hat: 0x1a2238, goggles: true },
  ],
};

export function skinFor(team: Team, model: number): Skin {
  const list = SKINS[team];
  return list[((model % list.length) + list.length) % list.length];
}
