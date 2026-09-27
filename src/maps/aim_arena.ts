import { MapBuilder } from './builder';

export function aimArena() {
  const m = new MapBuilder('aim_arena');
  const W = 1024;
  const D = 768;
  const H = 320;

  m.box(-W - 64, -32, -D - 64, W + 64, 0, D + 64, 'sand');
  m.box(-W - 64, 0, -D - 64, W + 64, H, -D, 'plaster');
  m.box(-W - 64, 0, D, W + 64, H, D + 64, 'plaster');
  m.box(-W - 64, 0, -D, -W, H, D, 'brick');
  m.box(W, 0, -D, W + 64, H, D, 'brick');
  m.box(-W - 64, 0, -D - 64, W + 64, 8, -D, 'trim');

  // North catwalk, stairs up from the west and a ramp from the east.
  m.box(-512, 0, -D, 512, 128, -D + 128, 'concrete');
  m.stairs(-768, -D, -512, -D + 128, 0, 128, '+x', 'concrete_dark');
  m.ramp(512, 0, -D, 832, 128, -D + 128, '-x', 'metal_floor');
  m.box(-512, 128, -D + 120, 512, 160, -D + 128, 'metal');

  // Centre wall with a doorway.
  m.box(-32, 0, -200, 32, 192, 120, 'plaster_dark');
  m.box(-32, 0, 250, 32, 192, 500, 'plaster_dark');
  m.box(-32, 128, 120, 32, 192, 250, 'plaster_dark');
  m.box(-40, 0, 120, 40, 8, 250, 'trim');

  // Crate clusters, mirrored so both sides get the same cover.
  for (const s of [-1, 1]) {
    m.crate(s * 300, 0, 64);
    m.crate(s * 300, 64, 64);
    m.crate(s * 364, 32, 64);
    m.crate(s * 330, 32, 48, 64);
    m.crate(s * 520, 420, 96);
    m.crate(s * 440, 440, 56, 0, 'crate_dark');
    m.crate(s * 200, -420, 64);
    m.crate(s * 250, -470, 48, 0, 'crate_dark');
    m.box(s * 640, 0, 180, s * 900, 128, 280, s < 0 ? 'container_red' : 'container_blue');
  }

  m.spawn('T', -900, -300, -90).spawn('T', -900, -100, -90).spawn('T', -900, 100, -90).spawn('T', -900, 300, -90).spawn('T', -850, 500, -90);
  m.spawn('CT', 900, -300, 90).spawn('CT', 900, -100, 90).spawn('CT', 900, 100, 90).spawn('CT', 900, 300, 90).spawn('CT', 850, 500, 90);
  m.buyzone('T', -W, -D, -700, D).buyzone('CT', 700, -D, W, D);
  m.bombsite('A', -200, -700, 200, -400);

  return m.build({
    sky: { top: 0x4a78b0, horizon: 0xc8d8e0 },
    sun: { dir: [-0.5, -1, -0.3], color: 0xfff2dd, intensity: 1.6 },
    ambient: 1.5,
  });
}
