import { MapBuilder } from './builder';
import { Carver } from './carver';

// A cache-shaped map from memory, not the real geometry. North is -z.
// T spawn west, CT spawn east, A site north (via A main and highway), B site south (via B main and sunroom),
// mid runs straight through with garage up to A and checkers down to B.
export function deCache() {
  const m = new MapBuilder('de_cache');
  const c = new Carver(-2600, -2200, 2000, 2200);
  const indoor = { ceiling: 192, ceilingTex: 'concrete_dark', floor: 'concrete_floor' };

  c.room(-2500, -500, -1900, 500, 0, { floor: 'asphalt' }); // T spawn
  c.room(-2300, -1300, -1900, -500, 0, { floor: 'asphalt' }); // T north
  c.room(-2300, 500, -1900, 1300, 0, { floor: 'asphalt' }); // T south
  c.room(-1900, -1300, -700, -900, 0, { floor: 'asphalt' }); // A main
  c.room(-700, -2000, 500, -700, 0, { floor: 'concrete_floor' }); // A site
  c.room(500, -2000, 1100, -1500, 0, { floor: 'asphalt' }); // highway
  c.room(1100, -1700, 1500, -900, 0, { floor: 'asphalt' }); // CT to A
  c.room(-700, -700, -200, -250, 0, indoor); // garage
  // Mid ends in a wall; CT mid turns north into spawn so the spawns never see each other.
  c.room(-1900, -250, 600, 250, 0, { floor: 'asphalt' }); // mid
  c.room(600, -700, 900, 250, 0, { floor: 'asphalt' }); // CT mid
  c.room(900, -1300, 1800, -500, 0, { floor: 'concrete_floor' }); // CT spawn
  c.room(1400, -500, 1800, 900, 0, { floor: 'concrete_floor' }); // CT hallway to B
  c.room(200, 250, 500, 800, 0, { ...indoor, floor: 'tile' }); // checkers
  c.room(-1900, 900, -800, 1300, 0, { floor: 'asphalt' }); // B main
  c.room(-800, 800, 300, 2000, 0, { floor: 'concrete_floor' }); // B site
  c.room(300, 900, 700, 1300, 0, indoor); // sunroom
  c.room(700, 900, 1800, 1300, 0, { floor: 'asphalt' }); // CT to B

  c.wallTex(-2600, -2200, -700, 2200, 'concrete', 288);
  c.wallTex(-700, -2200, 500, -700, 'brick_red', 320);
  c.wallTex(-700, 700, 700, 2200, 'tile', 288);
  c.wallTex(700, -2200, 2000, 2200, 'metal', 272);
  c.build(m, 256, 'concrete', 'asphalt', -64, { cap: 'trim_grey', skirting: 'concrete_dark', segment: 384, jitter: [0, 0, 48, 96, -32, 160] });

  // A main truck and A site "quad".
  m.box(-1450, 0, -1250, -1150, 128, -1030, 'container_red');
  m.box(-150, 0, -1500, 150, 96, -1250, 'container_green');
  m.box(-150, 96, -1450, 50, 160, -1300, 'container_yellow');
  m.crate(-500, -1850, 64).crate(-436, -1850, 64).crate(-468, -1850, 48, 64);
  // Chernobyl-grey industry: pipes along the walls, hazard stripes, barrels everywhere.
  m.detail(-700, 180, -2000, 500, 196, -1984, 'metal').detail(-700, 196, -1990, 500, 204, -1984, 'hazard');
  m.detail(-1900, 150, -1316, -700, 166, -1300, 'metal');
  m.barrel(-650, -1950, 0, 'barrel_rust').barrel(-610, -1960, 0, 'barrel_red').barrel(450, -1950, 0, 'barrel_blue');
  m.barrel(-1850, -1250, 0, 'barrel_rust').barrel(-1810, -1260, 0, 'barrel_rust');
  m.pillar(-400, -1100, 22, 0, 256, 'concrete').pillar(200, -1100, 22, 0, 256, 'concrete'); // A site columns
  m.sandbags(600, -1900, 700, -1860); // highway
  m.detail(-700, 0, -704, -200, 6, -696, 'hazard'); // garage door line
  m.box(200, 0, -1000, 330, 80, -900, 'metal'); // forklift
  m.crate(380, -1900, 56);
  m.crate(-600, -800, 64, 0, 'crate_dark');
  // Highway barriers.
  m.box(700, 0, -1800, 760, 40, -1600, 'concrete');
  // Mid: white box and cover.
  m.box(-500, 0, -80, -400, 64, 80, 'tile');
  m.crate(300, -150, 64).crate(300, -86, 64);
  m.box(-1300, 0, 120, -1150, 48, 250, 'concrete');
  // B site: containers and heaven.
  m.box(-500, 0, 1250, -200, 128, 1480, 'container_blue');
  m.box(0, 0, 1500, 220, 96, 1760, 'container_red');
  m.crate(-650, 1100, 64).crate(-586, 1100, 64);
  m.box(-800, 0, 1820, -400, 112, 2000, 'concrete');
  m.stairs(-400, 1820, -300, 2000, 0, 112, '-x', 'concrete_dark');
  m.box(-800, 112, 1800, -400, 144, 1820, 'metal');
  m.barrel(250, 1950, 0, 'barrel_blue').barrel(210, 1960, 0, 'barrel_rust').barrel(-750, 850, 0, 'barrel_red');
  m.car(-1400, 1100, true, 0, 'car_white'); // B main
  m.sandbags(1500, 1000, 1540, 1200); // CT to B
  m.pillar(-100, 1300, 22, 0, 256, 'concrete');
  m.crate(150, 950, 48, 0, 'crate_dark');
  // CT spawn cover.
  m.box(1250, 0, -1000, 1400, 96, -800, 'container_blue');
  m.car(1000, -650, true, 0, 'car_green'); // CT spawn
  m.barrel(950, -1250).barrel(990, -1260, 0, 'barrel_blue');
  m.barrel(-2450, 450, 0, 'barrel_rust').barrel(-2410, 460, 0, 'barrel_rust'); // T spawn
  m.chamfer(-700, -900, 64, 'se', 0, 256, 'concrete');

  for (let i = 0; i < 5; i++) m.spawn('T', -2350, -320 + i * 160, -90);
  for (let i = 0; i < 5; i++) m.spawn('CT', 1600, -1200 + i * 150, 90);
  m.buyzone('T', -2500, -600, -1900, 600).buyzone('CT', 900, -1300, 1800, -500);
  m.bombsite('A', -550, -1950, 350, -1000);
  m.bombsite('B', -750, 1000, 250, 1950);

  m.callout('T Spawn', -2500, -500, -1900, 500)
    .callout('A Main', -1900, -1300, -700, -900)
    .callout('A Site', -700, -2000, 500, -700)
    .callout('Highway', 500, -2000, 1100, -1500)
    .callout('Garage', -700, -700, -200, -250)
    .callout('Mid', -1900, -250, 900, 250)
    .callout('White Box', -550, -120, -350, 120)
    .callout('CT Spawn', 900, -1300, 1800, -500)
    .callout('CT Mid', 600, -700, 900, 250)
    .callout('Checkers', 200, 250, 500, 800)
    .callout('B Main', -1900, 900, -800, 1300)
    .callout('B Site', -800, 800, 300, 2000)
    .callout('Heaven', -800, 1800, -300, 2000)
    .callout('Sunroom', 300, 900, 700, 1300);

  return m.build({
    sky: { top: 0x6a8aa8, horizon: 0xc8ccc8 },
    sun: { dir: [-0.35, -1, 0.5], color: 0xf4f0e8, intensity: 1.6 },
    ambient: 1.5,
    fog: [0xb8bcbc, 1500, 9000],
  });
}
