// Deterministic browser check of the real weapon input, audio decoding, impact rendering, and reset.
// Run after npm run build. Screenshots go into the ignored test-results/nuke directory.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { preview } from 'vite';

const output = 'test-results/nuke';
await mkdir(output, { recursive: true });
const server = await preview({ preview: { port: 4996, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => errors.push(String(e.stack ?? e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text() || `console error at ${JSON.stringify(m.location())}`); });
  await page.goto('http://localhost:4996/?map=de_dust2&team=CT&debug&nomenu&teammates=1&enemies=1');
  await page.waitForFunction(() => !!window.app);
  await page.evaluate(async () => {
    const a = window.app;
    a.renderer.gl.setAnimationLoop(null);
    await a.renderer.lightingReady;
    // Headless macOS does not provide pointer lock; mouse events still use the real Input bindings.
    a.input.locked = true;
    a.audio.unlock();
    a.mode.newRound();
    a.local.money = 800;
    a.game.takeEvents();
  });
  // Buy through the UI, then target and launch with the normal mouse buttons.
  await page.evaluate(() => window.app.buyMenu.open(window.app.local));
  await page.click('[data-item="silencer"]');
  assert.equal(await page.evaluate(() => window.app.local.weapon?.def.id), 'silencer');
  assert.equal(await page.evaluate(() => window.app.local.money), 0);
  await page.evaluate(() => window.app.buyMenu.close());

  const advance = async (seconds) => page.evaluate((seconds) => {
    const a = window.app;
    for (let i = 0; i < Math.round(seconds * 100); i++) {
      a.buildLocalCmd();
      a.game.tick();
      for (const e of a.game.takeEvents()) a.onEvent(e);
      a.input.endTick();
    }
    a.draw(1, 1 / 60, null);
  }, seconds);
  await advance(6);
  await page.waitForFunction(() => !!window.app.audio.strategicClip);
  const audio = await page.evaluate(() => ({ duration: window.app.audio.strategicClip.duration, state: window.app.audio.ctx.state }));
  assert.ok(audio.duration > 1 && audio.duration < 4);
  assert.equal(audio.state, 'running');
  await page.screenshot({ path: `${output}/armed.png` });

  await page.mouse.click(640, 360, { button: 'right' });
  await advance(0.3);
  assert.equal(await page.evaluate(() => window.app.local.weapon.targetSite), 1);
  await page.mouse.click(640, 360);
  await advance(0.01);
  const launched = await page.evaluate(() => window.app.game.nukes.strike);
  assert.ok(launched);
  assert.equal(launched.site, 'B');
  assert.ok(Math.abs(launched.impactAt - launched.launchedAt - 10) < 1e-7);
  assert.equal(await page.locator('.nuke-banner strong').textContent(), 'Strategic launch detected');
  await page.screenshot({ path: `${output}/warning.png` });

  // A committed launch leaves movement and weapon switching under the player's control.
  const start = await page.evaluate(() => window.app.local.origin);
  await page.keyboard.down('w');
  await advance(0.3);
  await page.keyboard.up('w');
  const moved = await page.evaluate(() => window.app.local.origin);
  assert.ok(Math.hypot(moved.x - start.x, moved.z - start.z) > 5);
  await page.keyboard.press('2');
  await advance(0.7);
  assert.equal(await page.evaluate(() => window.app.local.active), 'secondary');
  await advance(6);
  await page.screenshot({ path: `${output}/missile.png` });
  assert.equal(await page.evaluate(() => window.app.game.nukes.strike.exploded), false);

  await advance(3.4);
  assert.equal(await page.evaluate(() => window.app.game.players.some((p) => p.alive)), false);
  assert.equal(await page.evaluate(() => window.app.mode.lastReason), 'nuke');
  const camera = await page.evaluate(() => {
    const a = window.app;
    return { eye: a.renderer.camera.position, player: a.local.origin };
  });
  assert.ok(Math.hypot(camera.eye.x - camera.player.x, camera.eye.z - camera.player.z) < 0.1, 'impact must keep the camera at the player');
  assert.ok(camera.eye.y - camera.player.y < 72, 'impact must not switch to an aerial camera');
  assert.equal(await page.locator('.nuke-banner').isHidden(), true);
  assert.equal(await page.locator('.hud-bottom').isVisible(), true);
  assert.equal(await page.locator('.radar').isVisible(), true);
  assert.equal(await page.locator('.center-msg').textContent(), 'Counter-Terrorists Win!');
  await page.screenshot({ path: `${output}/impact.png` });
  await advance(2);
  // Normal spectator controls still work while the mushroom cloud is growing.
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Space');
    await advance(0.01);
  }
  assert.equal(await page.evaluate(() => window.app.specMode), 'roam');
  const before = await page.evaluate(() => window.app.renderer.camera.position);
  await page.keyboard.down('w');
  await advance(0.2);
  await page.keyboard.up('w');
  const after = await page.evaluate(() => window.app.renderer.camera.position);
  assert.ok(Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z) > 5, 'free-roam camera must respond to movement');
  await page.screenshot({ path: `${output}/cloud.png` });
  await advance(2.5);
  assert.equal(await page.evaluate(() => window.app.game.nukes.strike), null);
  assert.equal(await page.locator('.nuke-overlay').isHidden(), true);
  assert.equal(await page.evaluate(() => window.app.game.players.every((p) => p.alive)), true);
  await page.screenshot({ path: `${output}/reset.png` });
  assert.deepEqual(errors, []);
  console.log(`Silencer: buy, target B, 10s impact, voice (${audio.duration.toFixed(3)}s), player camera, HUD, spectator controls, and normal round reset passed. Screenshots: ${output}`);
} finally {
  await browser.close();
  await server.close();
}
