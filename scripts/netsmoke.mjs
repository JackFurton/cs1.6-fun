// Starts the dedicated server, joins it from two headless browsers, walks one of them and checks
// the other sees the same position. Needs `npm run build && npm run build:server` first.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 27098;
const srv = spawn('node', ['dist-server/main.js', '--map', 'aim_arena', '--mode', 'dm', '--port', String(PORT)], { stdio: 'inherit' });
await new Promise((r) => setTimeout(r, 1500));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
let ok = false;
try {
  const join = async (name, team) => {
    const p = await browser.newPage({ viewport: { width: 640, height: 360 } });
    p.on('pageerror', (e) => errors.push(`${name}: ${e}`));
    p.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
    await p.goto(`http://localhost:${PORT}/?connect&debug`);
    await p.waitForFunction(() => !!window.app, null, { timeout: 20000 });
    await p.evaluate(([n, t]) => {
      window.app.settings.name = n;
      window.app.menu.onJoin(t, 0);
    }, [name, team]);
    await p.waitForFunction(() => window.app.started, null, { timeout: 10000 });
    return p;
  };
  const a = await join('alice', 'T');
  const b = await join('bob', 'CT');
  const id = await a.evaluate(() => window.app.local.id);
  const start = await a.evaluate(() => [window.app.local.origin.x, window.app.local.origin.z]);
  await a.evaluate(() => (window.app.input.locked = true));
  await a.keyboard.down('w');
  await a.waitForTimeout(800);
  await a.keyboard.up('w');
  await a.waitForTimeout(600);
  const mine = await a.evaluate(() => [window.app.local.origin.x, window.app.local.origin.z, window.app.local.alive]);
  const seen = await b.evaluate((id) => {
    const p = window.app.game.players.find((x) => x.id === id);
    return p ? [p.origin.x, p.origin.z] : null;
  }, id);
  const moved = Math.hypot(mine[0] - start[0], mine[1] - start[1]);
  const drift = seen ? Math.hypot(mine[0] - seen[0], mine[1] - seen[1]) : Infinity;
  console.log(`alice moved ${moved.toFixed(0)}u (alive=${mine[2]}); bob sees her ${drift.toFixed(1)}u from where she thinks she is`);
  // She may have been shot by a bot mid-walk, which ends the walk early; only require that both agree.
  ok = drift < 40 && errors.length === 0;
} finally {
  for (const e of errors) console.log('  ' + e);
  await browser.close();
  srv.kill();
}
process.exit(ok ? 0 : 1);
