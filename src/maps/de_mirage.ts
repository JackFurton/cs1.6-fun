import { MapBuilder } from './builder';
import { Carver } from './carver';

// A mirage-shaped map from memory, not the real geometry. North is -z.
// T spawn east, CT spawn west. A site south (via A ramp or palace), B site north (via apartments or short),
// mid runs east-west with connector/jungle down to A.
export function deMirage() {
  const m = new MapBuilder('de_mirage');
  const c = new Carver(-2600, -2400, 2600, 2400);
  const indoor = { ceiling: 176, ceilingTex: 'wood', floor: 'tile' };

  c.room(1900, -300, 2500, 500, 0, { floor: 'sand' }); // T spawn
  c.room(1500, 500, 2100, 1100, 0, { floor: 'sand' }); // T ramp
  c.room(400, 1100, 1700, 1400, 0, { floor: 'stone' }); // A ramp
  c.room(2100, 500, 2500, 1700, 0, { floor: 'sand' }); // outside palace
  c.room(1200, 1700, 2500, 2000, 64, indoor); // palace
  c.room(800, 1700, 1200, 2000, 0, { floor: 'stone' }); // palace balcony (ramp down to A)
  c.room(-600, 900, 800, 2100, 0, { floor: 'stone' }); // A site
  c.room(-1400, 600, -600, 1400, 0, { floor: 'stone' }); // CT to A
  c.room(-600, 300, -200, 900, 0, indoor); // jungle / connector
  c.room(700, -200, 1900, 300, 0, { floor: 'sand' }); // top mid
  c.room(-600, -300, 700, 300, 0, { floor: 'stone' }); // mid
  // Window: a raised sniper room at the end of mid, walled off from CT spawn, stairs down toward CT.
  c.room(-1300, -400, -600, 200, 96, { ceiling: 240, ceilingTex: 'wood', floor: 'wood' }); // window room
  c.room(-1300, 200, -1100, 600, 0, { floor: 'stone' }); // window stairs
  c.room(-200, -1100, 200, -300, 0, { floor: 'stone' }); // short
  c.room(1900, -1400, 2500, -300, 0, { floor: 'sand' }); // T to apartments
  c.room(300, -1500, 1900, -1200, 64, indoor); // apartments
  c.room(0, -1500, 300, -1200, 0, { floor: 'stone' }); // apartments exit
  c.room(-1400, -2100, 0, -1100, 0, { floor: 'stone' }); // B site
  c.room(-1600, -1100, -1100, -600, 0, { floor: 'stone' }); // market
  c.room(-2400, -700, -1400, 900, 0, { floor: 'stone' }); // CT spawn

  // Mirage's Moroccan palette: whitewash on the T side, warm orange round mid and A, brick at CT.
  c.wallTex(-600, -600, 800, 600, 'plaster_orange', 240);
  c.wallTex(-2600, -2400, -1100, 2400, 'brick', 272);
  c.wallTex(-1100, 600, 800, 2400, 'plaster_orange', 256);
  c.wallTex(800, 1400, 2600, 2400, 'plaster_white', 288);
  c.wallTex(-1100, -2400, 300, -600, 'plaster_blue', 256);
  c.wallTex(-2600, -2400, 2600, 2400, 'plaster_white', 256);
  c.build(m, 256, 'plaster_white', 'sand', -64, { cap: 'trim_sand', skirting: 'trim', segment: 288, jitter: [0, 0, 24, 56, -24, 88], facades: true });

  m.ramp(800, 0, 1700, 1200, 64, 2000, '+x', 'stone'); // balcony up into palace
  m.stairs(2100, 1500, 2500, 1700, 0, 64, '+z', 'stone'); // up into palace from outside
  m.stairs(1900, -1500, 2100, -1200, 0, 64, '-x', 'wood'); // up into apartments
  m.stairs(-1300, 200, -1100, 600, 0, 96, '-z', 'wood'); // window down to CT
  m.ramp(0, 0, -1500, 300, 64, -1200, '+x', 'stone'); // down out of apartments

  // Window: a waist-high sill and a lintel turn the open edge of the window room into an actual window.
  m.box(-616, 96, -300, -600, 132, 100, 'plaster_orange');
  m.box(-616, 196, -400, -600, 240, 200, 'plaster_orange');
  m.box(-616, 96, -400, -600, 196, -300, 'plaster_orange').box(-616, 96, 100, -600, 196, 200, 'plaster_orange');
  m.detail(-624, 132, -304, -600, 137, 104, 'trim_sand');
  // Arches on the classic doorways.
  m.arch(1180, 1700, 1200, 2000, 64, 112, 0, 'plaster_white'); // palace onto the balcony
  m.arch(280, -1500, 300, -1200, 64, 112, 0, 'plaster_blue'); // apartments exit
  m.arch(-600, 300, -580, 900, 0, 176, 0, 'plaster_orange'); // jungle from connector side
  m.arch(-1600, -620, -1100, -600, 0, 176, 256, 'brick'); // market door from CT
  m.arch(1500, 1080, 2100, 1100, 0, 184, 256, 'plaster_white'); // top of T ramp
  // Palace columns, beams and an awning over the balcony.
  m.pillar(1500, 1850, 18, 64, 176, 'stone').pillar(1900, 1850, 18, 64, 176, 'stone');
  m.awning(800, 1700, 1180, 1760, 176, '+z', 'roof_tile');
  // Ticket booth in CT, a little kiosk you can play round.
  m.box(-1100, 0, 1000, -980, 104, 1120, 'plaster_blue');
  m.detail(-1110, 104, 990, -970, 116, 1130, 'roof_tile');
  m.detail(-980, 44, 1020, -978, 88, 1100, 'window_dark');
  // A stairs: a raised corner on site, the high ground CTs love.
  m.box(-600, 0, 1780, -380, 48, 2100, 'stone');
  m.stairs(-380, 1780, -300, 2100, 0, 48, '-x', 'stone');
  m.barrel(-560, 2040, 48, 'barrel_blue');

  // A site cover: triple, firebox, sandwich, stairs area.
  m.crate(300, 1500, 64).crate(364, 1500, 64).crate(332, 1500, 48, 64);
  m.box(-100, 0, 1200, 60, 72, 1320, 'concrete'); // firebox
  m.crate(-350, 1750, 64, 0, 'crate_dark');
  m.box(-500, 0, 1000, -380, 48, 1100, 'stone'); // sandwich
  m.crate(600, 1000, 56);
  m.crate(520, 1260, 64).crate(584, 1260, 64).crate(552, 1260, 56, 64); // tetris
  m.barrel(760, 1880).barrel(730, 1920, 0, 'barrel_rust');
  m.sandbags(200, 1150, 380, 1190); // ramp
  m.chamfer(800, 900, 64, 'sw', 0, 256, 'plaster_orange');
  // Mid boxes.
  m.crate(300, -150, 64).crate(300, -86, 64);
  m.box(-400, 0, 100, -250, 56, 220, 'wood');
  // B site: van and bench.
  m.box(-900, 10, -1800, -600, 96, -1650, 'car_white');
  m.detail(-860, 60, -1802, -640, 88, -1648, 'window_dark');
  for (const x of [-860, -640]) m.detail(x - 12, 0, -1802, x + 12, 24, -1648, 'tire');
  m.barrel(-1350, -2050).barrel(-1310, -2060, 0, 'barrel_blue').barrel(-1340, -2010, 0, 'barrel_rust');
  m.pillar(-1100, -1100, 22, 0, 256, 'stone'); // market corner column
  m.awning(-1600, -1100, -1100, -1040, 176, '-z', 'roof_tile');
  m.sandbags(-80, -1300, 80, -1260); // short, from B
  m.box(-1300, 0, -1500, -1200, 32, -1300, 'wood');
  m.crate(-300, -1900, 64).crate(-300, -1836, 64);
  m.crate(2200, 0, 64, 0).crate(2300, 300, 56, 0, 'crate_dark');
  m.car(-2100, 700, true, 0, 'car_green'); // CT spawn
  m.barrel(-2350, -650).barrel(-2320, -610, 0, 'barrel_rust');
  m.barrel(1950, 1050, 0).barrel(1980, 1010, 0, 'barrel_rust'); // T ramp
  m.chamfer(1900, 300, 64, 'sw', 0, 256, 'plaster_white');

  for (let i = 0; i < 5; i++) m.spawn('T', 2300, -200 + i * 150, 90);
  for (let i = 0; i < 5; i++) m.spawn('CT', -2100, -300 + i * 150, -90);
  m.buyzone('T', 1900, -300, 2500, 500).buyzone('CT', -2400, -700, -1400, 700);
  m.bombsite('A', -400, 1250, 600, 1950);
  m.bombsite('B', -1250, -1950, -250, -1250);

  m.callout('T Spawn', 1900, -300, 2500, 500)
    .callout('T Ramp', 1500, 500, 2100, 1100)
    .callout('A Ramp', 400, 1100, 1700, 1400)
    .callout('Palace', 800, 1700, 2500, 2000)
    .callout('A Site', -600, 900, 800, 2100)
    .callout('CT', -1400, 600, -600, 1400)
    .callout('Jungle', -600, 300, -200, 900)
    .callout('Top Mid', 700, -200, 1900, 300)
    .callout('Mid', -600, -300, 700, 300)
    .callout('Window', -1400, -400, -600, 200)
    .callout('Short', -200, -1100, 200, -300)
    .callout('Apartments', 300, -1500, 2500, -300)
    .callout('B Site', -1400, -2100, 0, -1100)
    .callout('Market', -1400, -1100, -1100, -600)
    .callout('CT Spawn', -2400, -700, -1400, 700);

  return m.build({
    sky: { top: 0x5c8cc4, horizon: 0xe6dcc8 },
    sun: { dir: [-0.4, -1, -0.45], color: 0xfff2d8, intensity: 1.9 },
    ambient: 1.4,
    fog: [0xdcd4c0, 1500, 9000],
  });
}
