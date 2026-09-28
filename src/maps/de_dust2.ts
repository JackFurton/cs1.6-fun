import { MapBuilder } from './builder';
import { Carver } from './carver';

// de_dust2 from memory of the real radar, not its geometry. North (-z) is the CT side.
// T spawn south; long A runs up the east side to A (north-east), catwalk climbs from mid to A short,
// mid runs north to the mid doors, tunnels run up the west side to B (north-west).
// CT spawn sits east of the mid doors so nothing in one spawn can see the other.
export function deDust2() {
  const m = new MapBuilder('de_dust2');
  const c = new Carver(-2500, -2200, 2400, 3100);
  const tunnel = { ceiling: 208, ceilingTex: 'stone', floor: 'stone' };
  const lowTunnel = { ceiling: 144, ceilingTex: 'stone', floor: 'stone' };

  // T side.
  c.room(-1300, 2300, 300, 2900, 64, { floor: 'sand' }); // T spawn
  c.room(-350, 1900, 150, 2300, 64, { floor: 'sand' }); // top mid
  c.room(-350, 1500, 150, 1900, 0); // suicide (ramp)
  c.room(-1900, 2000, -1300, 2700, 64, { floor: 'sand' }); // outside tunnels
  c.room(300, 2200, 1700, 2800, 64, { floor: 'sand' }); // outside long
  c.room(1300, 1500, 1700, 2200, 0); // down to long doors (ramp)
  c.room(1300, 1100, 1700, 1500, 0, { ceiling: 160, ceilingTex: 'plaster' }); // long doors
  c.room(1300, -800, 1900, 1100, 0); // long A
  c.room(1900, -900, 2200, -300, -64, { floor: 'dirt' }); // pit
  c.room(1300, -900, 1900, -800, 0); // long corner

  // A.
  c.room(600, -2000, 1900, -900, 32); // A site (ramp up from long at its south-east)
  c.room(100, -1600, 600, -900, 32); // CT spawn side of A (CT ramp)
  c.room(300, -900, 600, 300, 64, { floor: 'concrete' }); // A short / catwalk top
  c.room(100, 300, 600, 700, 0); // catwalk stairs from mid (stairs added below)

  // Mid.
  c.room(-500, -100, 100, 1500, 0); // mid
  c.room(-500, -700, 100, -100, 0); // CT mid, beyond the doors
  c.room(-500, -1000, 300, -700, 0); // CT mid to CT spawn / B (ramp up)
  c.room(100, -1600, 900, -1000, 32); // CT spawn

  // B side.
  c.room(-1700, 800, -500, 1100, 0, lowTunnel); // lower tunnels
  c.room(-2100, 700, -1700, 2000, 64, tunnel); // upper tunnels
  // B tunnels turn east then north, so nobody in upper tunnels can see onto B.
  c.room(-2100, 300, -1300, 700, 32, tunnel); // tunnel bend
  c.room(-1600, -300, -1300, 300, 32, tunnel); // tunnel exit to B
  c.room(-2300, -1500, -1100, -300, 32); // B site
  c.room(-1100, -1100, -800, -800, 32, { ceiling: 192, ceilingTex: 'wood' }); // B doors
  c.room(-800, -1300, -300, -800, 32); // CT to B

  c.wallTex(-2500, 1900, -1300, 3100, 'brick', 256);
  c.wallTex(-1300, 1900, 2400, 3100, 'plaster', 224);
  c.wallTex(-2500, -2200, -1000, 1900, 'brick', 288);
  c.wallTex(-1000, -2200, 300, -700, 'plaster', 256);
  c.wallTex(-500, -700, 300, 1900, 'plaster_dark', 240);
  c.wallTex(300, -2200, 2400, -800, 'stone', 272);
  c.wallTex(300, -800, 2400, 1900, 'plaster', 288);
  c.build(m, 256, 'plaster', 'sand');

  // Height changes.
  m.ramp(-350, 0, 1500, 150, 64, 1900, '+z', 'sand'); // suicide
  m.ramp(1300, 0, 1500, 1700, 64, 2200, '+z', 'sand'); // outside long down to the doors
  m.ramp(1300, 0, -900, 1900, 32, -700, '-z', 'sand'); // long corner up onto A
  m.stairs(1900, -500, 2060, -300, -64, 0, '-x', 'stone'); // out of the pit
  m.stairs(100, 300, 600, 700, 0, 64, '-z', 'concrete_dark'); // catwalk stairs
  m.stairs(400, -1000, 600, -900, 32, 64, '+z', 'concrete_dark'); // A short down onto the site
  m.ramp(-500, 0, -1000, 300, 32, -700, '-z', 'sand'); // CT mid up to spawn
  m.stairs(-1700, 900, -1500, 1100, 0, 64, '-x', 'stone'); // lower tunnels up to upper
  m.stairs(-2100, 540, -1700, 700, 32, 64, '+z', 'stone'); // upper tunnels down toward B

  // Doors, thin enough to wallbang.
  m.box(1300, 0, 1492, 1470, 150, 1504, 'door');
  m.box(1530, 0, 1492, 1700, 150, 1504, 'door');
  m.box(-500, 0, -106, -250, 192, -94, 'door'); // mid doors, gap in the middle
  m.box(-150, 0, -106, 100, 192, -94, 'door');
  m.box(-250, 144, -106, -150, 192, -94, 'plaster_dark');
  m.box(-1108, 32, -1100, -1092, 192, -1010, 'door'); // B doors
  m.box(-1108, 32, -890, -1092, 192, -800, 'door');

  // Cover.
  m.crate(40, 620, 64).crate(40, 556, 48); // xbox
  m.box(1320, 0, 1000, 1440, 128, 1080, 'container_blue'); // blue at long doors
  m.crate(1800, 500, 64).crate(1800, 436, 64); // long boxes
  m.box(1650, 0, -820, 1880, 56, -760, 'stone'); // long corner cover
  m.box(1600, 32, -2000, 1900, 96, -1700, 'stone'); // goose
  m.box(1250, 32, -1180, 1420, 88, -1060, 'metal'); // A car
  m.crate(1050, -1550, 64, 32).crate(1114, -1550, 64, 32).crate(1050, -1486, 64, 32).crate(1082, -1518, 48, 96); // A default
  m.box(600, 32, -1300, 680, 72, -1100, 'stone'); // CT ramp cover
  m.box(-2300, 32, -1500, -1900, 96, -1200, 'stone'); // B platform
  m.stairs(-1900, -1500, -1800, -1200, 32, 96, '-x', 'stone');
  m.box(-1500, 32, -800, -1350, 88, -600, 'metal'); // B car
  m.crate(-1650, -1200, 64, 32).crate(-1586, -1200, 64, 32).crate(-1618, -1200, 48, 96); // B boxes
  m.crate(-1250, -450, 56, 32, 'crate_dark'); // tunnel exit box
  m.crate(-100, 2500, 64, 64).crate(-900, 2400, 64, 64).crate(-836, 2400, 56, 64); // T spawn
  m.crate(-250, 1950, 56, 64); // top mid box
  m.crate(-420, 1300, 48); // lower mid

  for (let i = 0; i < 5; i++) m.spawn('T', -800 + i * 180, 2700, 0, 64);
  for (let i = 0; i < 5; i++) m.spawn('CT', 250 + i * 140, -1450, 180, 32);
  m.buyzone('T', -1300, 2300, 300, 2900).buyzone('CT', 100, -1600, 900, -1000);
  m.bombsite('A', 900, -1900, 1700, -1100);
  m.bombsite('B', -2200, -1400, -1300, -500);

  m.callout('T Spawn', -1300, 2300, 300, 2900)
    .callout('Top Mid', -350, 1900, 150, 2300)
    .callout('Suicide', -350, 1500, 150, 1900)
    .callout('Mid', -500, -100, 100, 1500)
    .callout('Xbox', -40, 500, 100, 700)
    .callout('Mid Doors', -500, -150, 100, -50)
    .callout('CT Mid', -500, -1000, 300, -150)
    .callout('Outside Long', 300, 2200, 1300, 2800)
    .callout('Long Doors', 1300, 1100, 1700, 2200)
    .callout('Long A', 1300, -700, 1900, 1100)
    .callout('Pit', 1900, -900, 2200, -300)
    .callout('A Site', 600, -2000, 1900, -900)
    .callout('Goose', 1600, -2000, 1900, -1700)
    .callout('Catwalk', 100, -900, 600, 700)
    .callout('CT Spawn', 100, -1600, 900, -1000)
    .callout('Outside Tunnels', -1900, 2000, -1300, 2700)
    .callout('Upper Tunnels', -2100, 700, -1700, 2000)
    .callout('Lower Tunnels', -1700, 800, -500, 1100)
    .callout('B Tunnels', -2100, -300, -1300, 700)
    .callout('B Site', -2300, -1500, -1100, -300)
    .callout('B Doors', -1100, -1100, -800, -800)
    .callout('CT to B', -800, -1300, -300, -800);

  return m.build({
    sky: { top: 0x5a88c0, horizon: 0xe8dcc0 },
    sun: { dir: [0.45, -1, 0.35], color: 0xfff0d0, intensity: 1.9 },
    ambient: 1.4,
    fog: [0xd8ccb0, 1500, 9000],
  });
}
