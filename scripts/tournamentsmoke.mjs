import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const port = 27113;
const output = 'test-results/tournament';
await mkdir(output, { recursive: true });
const server = spawn(process.execPath, ['dist-server/main.js', '--mode', 'tournament', '--port', String(port)], { stdio: ['pipe', 'pipe', 'inherit'] });
let log = '';
server.stdout.on('data', (s) => { log += s; });
let browser;
try {
  for (let i = 0; i < 50 && !log.includes('cs1.6-fun server:'); i++) await new Promise((r) => setTimeout(r, 100));
  assert.match(log, /aim_arena \(tournament/);
  browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  const pages = [];
  for (const name of ['Alice16', 'Bob']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`http://localhost:${port}/?connect&debug`);
    await page.waitForFunction(() => window.app, null, { timeout: 60000 });
    await page.locator('[data-act="play"]').click();
    await page.locator('[name="pname"]').pressSequentially(name);
    await page.locator('[name="pname"]').fill(name);
    await page.locator('[data-act="tournamentjoin"]').click();
    await page.waitForFunction(() => window.app.started && window.app.mode.state.duos.length === 8);
    await page.locator('[data-duo="0"]').click();
    pages.push(page);
  }
  const [a, b] = pages;
  await a.waitForFunction(() => window.app.mode.members(0).every((p) => !p.isBot));
  for (const page of pages) {
    assert.equal(await page.locator('.tourney-duo').count(), 8);
    assert.match(await page.locator('[data-duo="0"]').innerText(), /Alice16/);
    assert.match(await page.locator('[data-duo="0"]').innerText(), /Bob/);
    assert.equal(await page.evaluate(() => window.app.game.players.length), 16);
  }
  await a.screenshot({ path: `${output}/duo-lobby.png` });
  await a.locator('[data-ready="true"]').click();
  await b.locator('[data-ready="true"]').click();
  await a.waitForFunction(() => window.app.mode.state.phaseEnd > window.app.game.time);
  assert.match(await a.locator('.tourney-status').innerText(), /Starting in/);
  await b.locator('[data-ready="false"]').click();
  await a.waitForFunction(() => window.app.mode.state.phaseEnd === 0);
  await b.locator('[data-ready="true"]').click();
  await a.waitForFunction(() => window.app.mode.state.phase === 'freeze', null, { timeout: 20000 });
  const state = await a.evaluate(() => {
    const a = window.app;
    return { active: a.game.players.filter((p) => p.alive).length, ids: a.mode.members(0).map((p) => p.id), teams: a.mode.members(0).map((p) => p.team), primary: a.local.weapon.def.id, yaw: a.yaw, spawnYaw: a.local.yaw };
  });
  assert.equal(state.active, 4);
  assert.equal(state.teams[0], state.teams[1]);
  assert.equal(state.primary, 'ak47');
  assert.equal(state.yaw, state.spawnYaw);
  await a.evaluate(async () => {
    const a = window.app;
    a.resume.style.display = 'none';
    a.menu.show(false);
    a.input.locked = true;
    await a.renderer.lightingReady;
  });
  await a.keyboard.down('Tab');
  await a.waitForFunction(() => document.querySelectorAll('.tourney-match').length === 7);
  await a.screenshot({ path: `${output}/bracket.png` });
  await a.keyboard.up('Tab');
  await a.waitForFunction(() => window.app.mode.state.phase === 'live');
  await a.screenshot({ path: `${output}/live-match.png` });
  server.stdin.write('tournament reset\n');
  await a.waitForFunction(() => window.app.mode.state.phase === 'lobby');
  await a.waitForFunction(() => document.querySelector('[data-duo="0"]'));
  assert.deepEqual(await a.evaluate(() => window.app.mode.members(0).map((p) => p.id)), state.ids);
  assert.equal(await a.evaluate(() => window.app.game.players.filter((p) => p.alive).length), 0);
  assert.deepEqual(errors, []);
  console.log('Tournament browser passed: two named humans share a duo, 16 slots, readiness/cancel, four-player match, loadout, spawn view, live bracket, and host reset keeps partners.');
} finally {
  await browser?.close();
  server.kill();
}
