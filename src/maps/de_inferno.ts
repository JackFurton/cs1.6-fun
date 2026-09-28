import { MapBuilder } from './builder';
import { Carver } from './carver';

// An inferno-shaped map from memory, not the real geometry. North is -z.
// T spawn south-west, CT spawn north-east. Banana runs north to B, mid and apartments lead east to A.
export function deInferno() {
  const m = new MapBuilder('de_inferno');
  const c = new Carver(-2400, -2600, 2400, 2600);
  const indoor = { ceiling: 224, ceilingTex: 'wood', floor: 'wood' };

  c.room(-2200, 1600, -1400, 2400, 0, { floor: 'stone' }); // T spawn
  c.room(-1600, 800, -1200, 1600, 0, { floor: 'stone' }); // T ramp
  // Banana bends east near the top, so the bottom can't see into B.
  c.room(-1200, -200, -800, 1000, 0, { floor: 'stone' }); // banana
  c.room(-950, -1400, -550, -200, 0, { floor: 'stone' }); // top of banana
  c.room(-1700, -2400, -200, -1400, 0, { floor: 'stone' }); // B site
  c.room(-1400, 1400, 0, 1800, 0, { floor: 'stone' }); // second mid
  c.room(0, 400, 600, 1800, 0, { floor: 'stone' }); // mid
  c.room(-700, 100, -300, 1400, 96, indoor); // apartments
  c.room(-300, 100, 700, 400, 96, indoor); // boiler to balcony
  c.room(700, 100, 1000, 400, 96, { floor: 'wood' }); // balcony
  c.room(600, 900, 1000, 1500, 0, { floor: 'stone' }); // short
  c.room(1000, 200, 2000, 1500, 0, { floor: 'stone' }); // A site
  c.room(1200, -400, 1600, 200, 0, { floor: 'stone' }); // library / arch
  c.room(800, -1300, 2200, -400, 0, { floor: 'stone' }); // CT spawn
  c.room(-200, -1100, 800, -700, 0, { floor: 'stone' }); // CT to B
  c.room(-500, -1400, -200, -700, 0, { floor: 'stone' }); // construction, into B
  c.room(1600, 1500, 2000, 2000, -64, { floor: 'dirt' }); // pit

  // Italian village: warm plaster houses, red brick lanes, stone round B.
  c.wallTex(-2400, -2600, -200, 0, 'stone', 240);
  c.wallTex(-800, 300, 1000, 800, 'plaster_orange', 288);
  c.wallTex(600, -2600, 2400, 2600, 'plaster', 272);
  c.wallTex(-2400, 1300, 600, 2600, 'plaster_white', 256);
  c.wallTex(-2400, -2600, 2400, 2600, 'brick_red', 256);
  c.build(m, 256, 'brick_red', 'stone', -64, { cap: 'roof_tile', skirting: 'trim', segment: 256, jitter: [0, 0, 32, 64, -24, 96], facades: true });

  m.stairs(-700, 1400, -300, 1560, 0, 96, '-z', 'wood'); // up into apartments from second mid
  m.ramp(1000, 0, 200, 1300, 96, 400, '-x', 'wood'); // ramp from balcony down onto A
  m.stairs(1600, 1500, 2000, 1660, -64, 0, '-z', 'stone'); // out of pit

  // Arches, which inferno has on nearly every corner.
  m.arch(1200, -420, 1600, -400, 0, 176, 256, 'plaster'); // library arch onto A
  m.arch(-950, -220, -550, -200, 0, 192, 240, 'stone'); // top of banana into B
  m.arch(-500, -1420, -200, -1400, 0, 160, 240, 'stone'); // construction into B
  m.arch(600, 900, 620, 1500, 0, 192, 272, 'plaster'); // short onto A
  m.arch(-1600, 1580, -1200, 1600, 0, 192, 256, 'plaster_white'); // T ramp
  // Banana: low planters down the lane, the cover everyone fights over.
  m.box(-1200, 0, 300, -1150, 36, 700, 'stone').detail(-1198, 36, 300, -1152, 44, 700, 'grass');
  m.box(-850, 0, -100, -800, 36, 200, 'stone').detail(-848, 36, -100, -802, 44, 200, 'grass');
  m.awning(-800, 500, -760, 900, 176, '-x', 'roof_tile');
  // Balcony railing and hanging beams over A.
  m.box(996, 96, 100, 1000, 132, 400, 'beam');
  m.detail(1000, 220, 200, 2000, 230, 220, 'beam').detail(1000, 220, 800, 2000, 230, 820, 'beam');
  // A site: cart, barrels, wall pillars, the well.
  m.car(1600, 1200, false, 0, 'car_white');
  m.barrel(1900, 300).barrel(1940, 330, 0, 'barrel_rust').barrel(1080, 1450, 0, 'barrel_blue');
  m.pillar(1400, 500, 26, 0, 40, 'stone').detail(1374, 40, 474, 1426, 46, 526, 'trim_grey'); // well
  m.pillar(1000, 200, 20, 0, 256, 'stone');
  // Mid and second mid dressing.
  m.barrel(560, 1760).barrel(520, 1760, 0, 'barrel_rust');
  m.sandbags(-1300, 1450, -1100, 1490);
  m.chamfer(0, 1800, 64, 'sw', 0, 256, 'plaster_white');

  // B site: fountain, coffins, new box.
  m.box(-1100, 0, -2000, -850, 48, -1750, 'stone');
  m.box(-600, 0, -2300, -300, 40, -2200, 'wood');
  m.box(-600, 0, -2150, -300, 40, -2050, 'wood');
  m.crate(-1500, -1600, 64).crate(-1436, -1600, 64).crate(-1468, -1600, 48, 64);
  m.pillar(-975, -1875, 60, 0, 30, 'stone', 12).pillar(-975, -1875, 14, 30, 90, 'stone'); // fountain basin and spout
  m.barrel(-1650, -2350).barrel(-1610, -2350, 0, 'barrel_rust').barrel(-250, -1450, 0, 'barrel_blue');
  m.sandbags(-1700, -1500, -1500, -1460);
  // Banana cover: car and sandbags.
  m.box(-1150, 0, 100, -1000, 56, 400, 'metal');
  m.box(-700, 0, -900, -620, 40, -700, 'sand');
  // A site: truck-style block, boxes.
  m.box(1300, 0, 700, 1500, 88, 1000, 'container_red');
  m.crate(1800, 400, 64).crate(1800, 464, 64);
  m.crate(1150, 1350, 56, 0, 'crate_dark');
  // Mid boxes.
  m.crate(300, 1100, 64);
  m.crate(-600, 1600, 48);

  for (let i = 0; i < 5; i++) m.spawn('T', -2000 + i * 120, 2200, 0);
  for (let i = 0; i < 5; i++) m.spawn('CT', 1200 + i * 150, -1000, 180);
  m.buyzone('T', -2200, 1600, -1400, 2400).buyzone('CT', 800, -1300, 2200, -400);
  m.bombsite('A', 1150, 350, 1900, 1150);
  m.bombsite('B', -1550, -2300, -350, -1500);

  m.callout('T Spawn', -2200, 1600, -1400, 2400)
    .callout('T Ramp', -1600, 800, -1200, 1600)
    .callout('Banana', -1200, -1400, -550, 1000)
    .callout('B Site', -1700, -2400, -200, -1400)
    .callout('Second Mid', -1400, 1400, 0, 1800)
    .callout('Mid', 0, 400, 600, 1800)
    .callout('Apartments', -700, 100, 700, 1400)
    .callout('Balcony', 700, 100, 1000, 400)
    .callout('Short', 600, 900, 1000, 1500)
    .callout('A Site', 1000, 200, 2000, 1500)
    .callout('Library', 1200, -400, 1600, 200)
    .callout('CT Spawn', 800, -1300, 2200, -400)
    .callout('CT to B', -200, -1100, 800, -700)
    .callout('Pit', 1600, 1500, 2000, 2000);

  return m.build({
    sky: { top: 0x6a90c0, horizon: 0xf0d8b8 },
    sun: { dir: [0.3, -1, 0.5], color: 0xffe8c8, intensity: 1.8 },
    ambient: 1.35,
    fog: [0xe0d0b8, 1500, 9000],
  });
}
