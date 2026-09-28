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

  c.wallTex(-2600, -2400, 2600, 2400, 'plaster', 256);
  c.wallTex(-600, -600, 800, 600, 'plaster_dark', 240);
  c.wallTex(-2600, -2400, -1100, 2400, 'brick', 272);
  c.build(m, 256, 'plaster', 'sand');

  m.ramp(800, 0, 1700, 1200, 64, 2000, '+x', 'stone'); // balcony up into palace
  m.stairs(2100, 1500, 2500, 1700, 0, 64, '+z', 'stone'); // up into palace from outside
  m.stairs(1900, -1500, 2100, -1200, 0, 64, '-x', 'wood'); // up into apartments
  m.stairs(-1300, 200, -1100, 600, 0, 96, '-z', 'wood'); // window down to CT
  m.ramp(0, 0, -1500, 300, 64, -1200, '+x', 'stone'); // down out of apartments

  // A site cover: triple, firebox, sandwich, stairs area.
  m.crate(300, 1500, 64).crate(364, 1500, 64).crate(332, 1500, 48, 64);
  m.box(-100, 0, 1200, 60, 72, 1320, 'concrete'); // firebox
  m.crate(-350, 1750, 64, 0, 'crate_dark');
  m.box(-500, 0, 1000, -380, 48, 1100, 'stone'); // sandwich
  m.crate(600, 1000, 56);
  // Mid boxes.
  m.crate(300, -150, 64).crate(300, -86, 64);
  m.box(-400, 0, 100, -250, 56, 220, 'wood');
  // B site: van and bench.
  m.box(-900, 0, -1800, -600, 96, -1650, 'container_yellow');
  m.box(-1300, 0, -1500, -1200, 32, -1300, 'wood');
  m.crate(-300, -1900, 64).crate(-300, -1836, 64);
  m.crate(2200, 0, 64, 0).crate(2300, 300, 56, 0, 'crate_dark');

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
