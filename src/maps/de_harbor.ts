import { MapBuilder } from './builder';
import { Carver } from './carver';

// An original map built the way CS maps are: three lanes (long pier to A, mid through the fish
// market, a sunken canal to B), a connector from mid to each site, a CT rotate corridor behind
// both sites, a raised platform on A for the high ground, and an enclosed warehouse on B so the
// two sites play differently. North (-z) is CT.
export function deHarbor() {
  const m = new MapBuilder('de_harbor');
  const c = new Carver(-2400, -2600, 2400, 2700);
  const warehouse = { ceiling: 272, ceilingTex: 'metal', floor: 'concrete_floor' };

  // T side.
  c.room(-600, 2000, 600, 2500, 0, { floor: 'cobble' }); // T spawn
  c.room(100, 1500, 600, 2000, 0, { floor: 'cobble' }); // top mid
  c.room(500, 2100, 1600, 2400, 0, { floor: 'cobble' }); // to the pier
  c.room(-1500, 2100, -600, 2400, -64, { floor: 'cobble' }); // down to the canal (ramp)

  // Mid and the courtyard at its north end.
  c.room(-250, -600, 250, 1600, 0, { floor: 'cobble' }); // mid: the fish market
  c.room(-600, -1200, 600, -600, 0, { floor: 'stone' }); // courtyard
  c.room(-600, -1700, -400, -1200, 0, { floor: 'stone' }); // courtyard to rotate, west
  c.room(400, -1700, 600, -1200, 0, { floor: 'stone' }); // courtyard to rotate, east

  // A: the docks.
  c.room(1500, -800, 1900, 2400, 0, { floor: 'planks_dock' }); // the pier (A long)
  c.room(1100, -1700, 2100, -700, 0, { floor: 'concrete_floor' }); // A site
  c.room(250, 200, 1100, 500, 0, { floor: 'cobble' }); // market alley (A short)
  c.room(900, -900, 1200, 500, 0, { floor: 'cobble' }); // alley up to A
  c.room(550, -900, 950, -700, 0, { floor: 'stone' }); // courtyard to A

  // B: the warehouse, reached by the canal or the west alley.
  c.room(-2000, -800, -1500, 2400, -64, { floor: 'water' }); // canal
  c.room(-2100, -1700, -1100, -800, 0, warehouse); // B site
  c.room(-1100, 0, -250, 300, 0, { floor: 'cobble' }); // west alley (B short)
  c.room(-1300, -800, -1000, 300, 0, { floor: 'stone' }); // alley north to the warehouse
  c.room(-1050, -900, -550, -700, 0, { floor: 'stone' }); // courtyard to B

  // CT spawn and the corridor behind both sites.
  c.room(-500, -2400, 500, -1900, 0, { floor: 'stone' }); // CT spawn
  c.room(-1300, -1900, 1300, -1600, 0, { floor: 'stone' }); // rotate

  c.wallTex(-2400, -2600, -1100, 2700, 'brick_red', 288);
  c.wallTex(1100, -2600, 2400, 2700, 'plaster_blue', 256);
  c.wallTex(-1100, 1500, 1100, 2700, 'plaster_white', 240);
  c.wallTex(-1100, -2600, 1100, -600, 'stone', 272);
  c.wallTex(-2400, -2600, 2400, 2700, 'plaster_white', 256);
  c.build(m, 256, 'plaster_white', 'cobble', -128, { cap: 'roof_tile', skirting: 'trim', segment: 288, jitter: [0, 0, 32, 64, -24, 96], facades: true });

  // Height changes.
  m.ramp(-1100, -64, 2100, -600, 0, 2400, '+x', 'cobble'); // down to the canal
  m.ramp(-2000, -64, -800, -1500, 0, -500, '-z', 'stone'); // canal up into the warehouse
  m.box(-2000, -64, 2400, -1500, -30, 2420, 'stone'); // canal end wall lip

  // A: crane platform (the high ground), containers, bollards along the pier.
  m.box(1100, 0, -1700, 1450, 72, -1400, 'metal');
  m.stairs(1450, -1700, 1600, -1400, 0, 72, '-x', 'metal_floor');
  m.detail(1250, 72, -1560, 1290, 400, -1520, 'hazard'); // crane mast
  m.detail(1250, 380, -1560, 1900, 400, -1520, 'hazard'); // crane jib
  m.box(1650, 0, -1300, 1950, 128, -1150, 'container_blue');
  m.box(1700, 128, -1280, 1900, 256, -1170, 'container_red');
  m.box(1300, 0, -1050, 1450, 96, -850, 'container_green');
  m.crate(1850, -850, 64).crate(1850, -786, 64).crate(1850, -850, 48, 64);
  for (let z = -600; z < 2300; z += 420) m.pillar(1880, z, 10, 0, 30, 'stone', 6);
  m.barrel(1540, 600).barrel(1570, 640, 0, 'barrel_blue').barrel(1860, 1500, 0, 'barrel_rust');
  // Pier doors halfway down: a doorway through a shed you can wallbang.
  m.box(1500, 0, 950, 1650, 200, 980, 'wood').box(1750, 0, 950, 1900, 200, 980, 'wood');
  m.box(1650, 136, 950, 1750, 200, 980, 'wood');
  m.awning(1500, 980, 1900, 1030, 190, '-z', 'roof_tile');

  // Mid: market stalls under awnings, a fountain at the courtyard, a CT balcony over mid.
  for (const z of [300, 800, 1250]) {
    m.box(-250, 0, z, -180, 36, z + 120, 'wood').awning(-250, z - 20, -140, z + 140, 150, '-x', 'roof_tile');
    m.box(180, 0, z - 200, 250, 36, z - 80, 'wood').awning(140, z - 220, 250, z - 60, 150, '+x', 'roof_tile');
  }
  m.crate(-60, 1050, 48, 0, 'crate_dark');
  m.pillar(0, -900, 70, 0, 28, 'stone', 12).pillar(0, -900, 14, 28, 100, 'stone');
  m.box(-600, 0, -1200, -250, 96, -1080, 'stone'); // CT balcony over the courtyard
  m.stairs(-250, -1200, -150, -1080, 0, 96, '-x', 'stone');
  m.box(-600, 96, -1080, -250, 132, -1072, 'beam'); // balcony rail
  m.arch(-250, 1580, 250, 1600, 0, 176, 240, 'plaster_white'); // top of mid
  m.arch(-250, -620, 250, -600, 0, 192, 272, 'stone'); // mid into the courtyard

  // B: the warehouse. Shelving, forklift, crates, and a raised office in the corner.
  m.box(-2100, 0, -1700, -1800, 96, -1450, 'concrete');
  m.stairs(-1800, -1700, -1700, -1450, 0, 96, '-x', 'concrete_dark');
  m.box(-2100, 96, -1450, -1800, 128, -1442, 'beam');
  for (const x of [-1650, -1450]) {
    m.box(x, 0, -1350, x + 60, 160, -1050, 'metal');
    m.crate(x + 30, -1300, 48, 160, 'crate_dark');
  }
  m.crate(-1250, -1600, 64).crate(-1186, -1600, 64).crate(-1218, -1600, 48, 64);
  m.car(-1300, -950, true, 0, 'car_green');
  m.pillar(-1600, -1100, 16, 0, 272, 'metal').pillar(-1600, -1500, 16, 0, 272, 'metal');
  m.arch(-2000, -820, -1500, -800, 0, 176, 272, 'brick_red'); // warehouse doors from the canal
  m.arch(-1300, -820, -1000, -800, 0, 160, 272, 'brick_red'); // warehouse from the alley
  m.barrel(-1950, 1200, -64, 'barrel_rust').barrel(-1560, 400, -64, 'barrel_blue'); // canal
  m.sandbags(-900, 30, -700, 70); // B short

  // CT spawn.
  m.car(-300, -2250, true, 0, 'car_white');
  m.barrel(420, -2350, 0, 'barrel_blue').barrel(380, -2360);
  m.crate(-1200, -1800, 56).crate(1200, -1800, 56);

  for (let i = 0; i < 5; i++) m.spawn('T', -400 + i * 200, 2350, 0);
  for (let i = 0; i < 5; i++) m.spawn('CT', -400 + i * 200, -2050, 180);
  m.buyzone('T', -600, 2000, 600, 2500).buyzone('CT', -500, -2400, 500, -1900);
  m.bombsite('A', 1150, -1650, 2050, -750);
  m.bombsite('B', -2050, -1650, -1150, -850);

  m.callout('T Spawn', -600, 2000, 600, 2500)
    .callout('Top Mid', 100, 1500, 600, 2000)
    .callout('Market', -250, -600, 250, 1600)
    .callout('Courtyard', -600, -1200, 600, -600)
    .callout('Balcony', -600, -1200, -150, -1072)
    .callout('Pier', 1500, -700, 1900, 2400)
    .callout('Pier Shed', 1500, 900, 1900, 1050)
    .callout('A Site', 1100, -1700, 2100, -700)
    .callout('Crane', 1100, -1700, 1600, -1400)
    .callout('Fish Alley', 250, 200, 1200, 500)
    .callout('A Short', 900, -900, 1200, 200)
    .callout('Canal', -2000, -500, -1500, 2400)
    .callout('Warehouse', -2100, -1700, -1100, -800)
    .callout('Office', -2100, -1700, -1700, -1450)
    .callout('West Alley', -1100, 0, -250, 300)
    .callout('B Short', -1300, -800, -1000, 0)
    .callout('Rotate', -1300, -1900, 1300, -1600)
    .callout('CT Spawn', -500, -2400, 500, -1900);

  return m.build({
    sky: { top: 0x4a7ab0, horizon: 0xd8e4ec },
    sun: { dir: [0.5, -1, -0.3], color: 0xfff4e0, intensity: 1.8 },
    ambient: 1.45,
    fog: [0xc8d8e0, 1600, 9000],
  });
}
