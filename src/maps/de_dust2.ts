import { MapBuilder } from './builder';
import { Carver } from './carver';

// A dust2-shaped map from memory, not a copy of the real geometry. North is -z.
// T spawn south, CT spawn north, A site north-east via long and catwalk, B site north-west via tunnels.
export function deDust2() {
  const m = new MapBuilder('de_dust2');
  const c = new Carver(-2400, -2800, 2200, 2800);
  const tunnel = { ceiling: 176, ceilingTex: 'stone', floor: 'stone' };

  // T side
  c.room(-800, 2000, 800, 2600, 64, { floor: 'sand' }); // T spawn
  c.room(-300, 1100, 300, 2000, 64, { floor: 'sand' }); // top mid
  c.room(-300, 700, 300, 1100, 0); // suicide ramp (ramp brush added below)
  c.room(800, 1700, 1400, 2300, 64, { floor: 'sand' }); // outside long
  c.room(1100, 1400, 1400, 1700, 0); // ramp down to long doors
  c.room(1100, 1150, 1400, 1400, 0, { ceiling: 144, ceilingTex: 'plaster' }); // long doors
  c.room(1100, -800, 1700, 1150, 0); // long A
  c.room(1700, 650, 2000, 1150, -64); // pit
  c.room(1100, -1100, 1700, -800, 0); // ramp up to A

  // A site and CT
  c.room(650, -2200, 1700, -1100, 32); // A site
  c.room(400, -1500, 650, -250, 64, { floor: 'concrete' }); // catwalk / short
  c.room(300, -250, 650, 100, 0); // catwalk stairs area (stairs added below)
  c.room(-700, -2600, 650, -1900, 32); // CT spawn
  c.room(-300, -1900, 300, -1600, 0); // CT mid ramp
  c.room(-300, -1600, 300, 700, 0); // mid

  // B side
  c.room(-1400, 250, -300, 550, 0, tunnel); // lower tunnels
  c.room(-1700, 1400, -700, 1900, 64, tunnel); // upper tunnels from T spawn
  c.room(-800, 1900, -700, 2100, 64); // tunnel mouth into T spawn
  c.room(-1700, -400, -1400, 1400, 32, tunnel); // tunnel run north
  c.room(-1700, -1300, -1400, -400, 32); // B tunnel exit
  c.room(-2100, -2300, -1000, -1300, 32); // B site
  c.room(-1000, -2200, -700, -1950, 32, { ceiling: 160, ceilingTex: 'wood' }); // B doors to CT

  c.wallTex(-2400, 1300, -700, 2800, 'brick', 256);
  c.wallTex(-700, 1300, 2200, 2800, 'plaster', 208);
  c.wallTex(-2400, -2800, -1000, 0, 'brick', 272);
  c.wallTex(-1000, -2800, 700, -1850, 'plaster', 240);
  c.wallTex(-300, -1000, 400, 800, 'plaster_dark', 224);
  c.wallTex(700, -2800, 2200, -700, 'stone', 256);
  c.wallTex(1700, -700, 2200, 1300, 'plaster', 288);
  c.build(m, 256, 'plaster', 'sand');

  // Height changes between rooms.
  m.ramp(-300, 0, 700, 300, 64, 1100, '+z', 'sand'); // suicide
  m.ramp(1100, 0, 1400, 1400, 64, 1700, '+z', 'sand'); // outside long down to doors
  m.ramp(1100, 0, -1100, 1700, 32, -800, '-z', 'sand'); // long up to A
  m.ramp(-300, 0, -1900, 300, 32, -1600, '-z', 'sand'); // CT mid up to CT spawn
  m.stairs(300, -250, 650, 100, 0, 64, '-z', 'concrete_dark'); // catwalk stairs
  m.stairs(1700, 650, 1860, 1150, -64, 0, '-x', 'stone'); // out of the pit
  m.stairs(-1400, 250, -1250, 550, 0, 32, '-x', 'stone'); // lower tunnels up to upper
  m.stairs(-1700, 1250, -1400, 1400, 32, 64, '+z', 'stone'); // tunnel steps

  // Long doors: double doors with a gap.
  m.box(1100, 0, 1260, 1210, 144, 1290, 'door');
  m.box(1290, 0, 1260, 1400, 144, 1290, 'door');
  // Mid doors.
  m.box(-300, 0, -920, -64, 192, -890, 'door');
  m.box(64, 0, -920, 300, 192, -890, 'door');
  m.box(-64, 128, -920, 64, 192, -890, 'plaster_dark');
  // B doors frame.
  m.box(-1000, 32, -2200, -980, 160, -2140, 'wood');
  m.box(-1000, 32, -2010, -980, 160, -1950, 'wood');

  // Cover.
  m.crate(250, -120, 64); // xbox
  m.crate(1500, 400, 64).crate(1500, 336, 64).crate(1564, 400, 64); // long corner boxes
  m.box(1150, 32, -2150, 1400, 96, -1900, 'stone'); // A goose platform
  m.crate(1000, -1500, 64, 32).crate(1064, -1500, 64, 32).crate(1000, -1436, 64, 32).crate(1032, -1468, 64, 96);
  m.crate(1450, -1300, 48, 32);
  m.box(-2100, 32, -2300, -1800, 96, -2050, 'stone'); // B platform
  m.crate(-1500, -1900, 64, 32).crate(-1436, -1900, 64, 32).crate(-1500, -1836, 64, 32).crate(-1468, -1868, 64, 96);
  m.box(-1250, 32, -1650, -1150, 88, -1450, 'metal'); // B car
  m.crate(-1900, -1600, 56, 32, 'crate_dark');
  m.crate(-100, 2300, 64, 64).crate(400, 2150, 64, 64);

  for (let i = 0; i < 5; i++) m.spawn('T', -400 + i * 160, 2450, 0, 64);
  for (let i = 0; i < 5; i++) m.spawn('CT', -400 + i * 160, -2400, 180, 32);
  m.buyzone('T', -800, 2000, 800, 2600).buyzone('CT', -700, -2600, 650, -1900);
  m.bombsite('A', 850, -2050, 1650, -1250);
  m.bombsite('B', -2050, -2250, -1250, -1450);

  m.callout('T Spawn', -800, 2000, 800, 2600)
    .callout('Top Mid', -300, 1100, 300, 2000)
    .callout('Mid', -300, -900, 300, 700)
    .callout('Mid Doors', -300, -1600, 300, -900)
    .callout('Xbox', 150, -250, 350, 0)
    .callout('Outside Long', 800, 1400, 1400, 2300)
    .callout('Long Doors', 1100, 1150, 1400, 1400)
    .callout('Long A', 1100, -1100, 1700, 1150)
    .callout('Pit', 1700, 650, 2000, 1150)
    .callout('A Site', 650, -2200, 1700, -1100)
    .callout('Catwalk', 300, -1500, 650, 100)
    .callout('CT Spawn', -700, -2600, 650, -1900)
    .callout('Lower Tunnels', -1400, 250, -300, 550)
    .callout('Upper Tunnels', -1700, -400, -700, 2100)
    .callout('B Site', -2100, -2300, -1000, -1300)
    .callout('B Doors', -1000, -2200, -700, -1950);

  return m.build({
    sky: { top: 0x5a88c0, horizon: 0xe8dcc0 },
    sun: { dir: [0.45, -1, 0.35], color: 0xfff0d0, intensity: 1.9 },
    ambient: 1.4,
    fog: [0xd8ccb0, 1500, 9000],
  });
}
