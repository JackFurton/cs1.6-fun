import { MapBuilder } from './builder';

// fy_iceworld-style: a small frozen square with a walled centre, guns on the floor, no buying.
export function fyIceworld() {
  const m = new MapBuilder('fy_iceworld');
  const W = 1152;
  const H = 288;

  m.box(-W - 64, -32, -W - 64, W + 64, 0, W + 64, 'ice');
  m.box(-W - 64, 0, -W - 64, W + 64, H, -W, 'ice_wall');
  m.box(-W - 64, 0, W, W + 64, H, W + 64, 'ice_wall');
  m.box(-W - 64, 0, -W, -W, H, W, 'ice_wall');
  m.box(W, 0, -W, W + 64, H, W, 'ice_wall');

  // The centre block: four L-shaped walls with gaps you can peek through, and a hut in the middle.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      m.box(sx * 160, 0, sz * 160, sx * 520, 144, sz * 192, 'ice_wall');
      m.box(sx * 160, 0, sz * 192, sx * 192, 144, sz * 520, 'ice_wall');
      m.crate(sx * 700, sz * 700, 64, 0, 'crate');
      m.crate(sx * 764, sz * 700, 48, 0, 'crate_dark');
    }
  }
  m.box(-64, 0, -64, 64, 96, 64, 'snow');
  // Low cover near each spawn.
  for (const sz of [-1, 1]) {
    m.box(-300, 0, sz * 880, 300, 48, sz * 912, 'snow');
    m.box(-900, 0, sz * 400, -860, 80, sz * 160, 'ice_wall');
    m.box(860, 0, sz * 400, 900, 80, sz * 160, 'ice_wall');
  }

  for (let i = 0; i < 5; i++) m.spawn('T', -400 + i * 200, 1000, 0);
  for (let i = 0; i < 5; i++) m.spawn('CT', -400 + i * 200, -1000, 180);

  // The guns, laid out in front of each spawn like the real map.
  const kit = ['ak47', 'm4a1', 'awp', 'deagle', 'mp5', 'ak47', 'm4a1', 'scout', 'p90', 'deagle'] as const;
  kit.forEach((id, i) => {
    const x = -540 + i * 120;
    m.weapon(id, x, 820);
    m.weapon(id, x, -820);
  });

  m.callout('T Side', -W, 600, W, W).callout('CT Side', -W, -W, W, -600).callout('Middle', -600, -600, 600, 600);
  return m.build({
    sky: { top: 0x3a5a8a, horizon: 0xc8d8e8 },
    sun: { dir: [-0.3, -1, 0.2], color: 0xf0f4ff, intensity: 1.6 },
    ambient: 1.6,
    fog: [0xc8d4e0, 1500, 7000],
  });
}
