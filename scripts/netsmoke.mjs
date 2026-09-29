// Starts the dedicated server, joins it from two headless browsers, walks one of them and checks
// the other sees the same position. Needs `npm run build && npm run build:server` first.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 27098;
const srv = spawn('node', ['dist-server/main.js', '--map', 'aim_arena', '--mode', 'dm', '--port', String(PORT)], { stdio: 'inherit' });
// Wait until the server answers rather than guessing how long it takes to start.
for (let i = 0; i < 100; i++) {
  try {
    if ((await fetch(`http://localhost:${PORT}/`)).ok) break;
  } catch {
    // not up yet
  }
  await new Promise((r) => setTimeout(r, 200));
}
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
let ok = false;
try {
  // Load both pages before anyone joins: a page starting up next to one that's already rendering
  // the game can take 40s+ on a 2-core CI runner with software GL.
  const open = async (name) => {
    const p = await browser.newPage({ viewport: { width: 640, height: 360 } });
    p.on('pageerror', (e) => errors.push(`${name}: ${e}`));
    p.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
    await p.goto(`http://localhost:${PORT}/?connect&debug`);
    await p.waitForFunction(() => !!window.app, null, { timeout: 60000 });
    return p;
  };
  const join = async (p, name, team) => {
    await p.evaluate(([n, t]) => {
      window.app.settings.name = n;
      window.app.menu.onJoin(t, 0);
    }, [name, team]);
    await p.waitForFunction(() => window.app.started, null, { timeout: 60000 });
  };
  const [a, b] = await Promise.all([open('alice'), open('bob')]);
  await join(a, 'alice', 'T');
  await join(b, 'bob', 'CT');
  const id = await a.evaluate(() => window.app.local.id);
  const start = await a.evaluate(() => [window.app.local.origin.x, window.app.local.origin.z]);
  // Only the front tab gets animation frames, and each page runs its game loop on them.
  await a.bringToFront();
  await a.evaluate(() => (window.app.input.locked = true));
  await a.keyboard.down('w');
  await a.waitForTimeout(800);
  await a.keyboard.up('w');
  await a.waitForTimeout(600);
  const mine = await a.evaluate(() => [window.app.local.origin.x, window.app.local.origin.z, window.app.local.alive]);
  await b.bringToFront();
  // Bob's view only moves when his page draws a frame, and CI's software GL draws a few a second,
  // so give his interpolation time to catch up instead of sampling at a fixed moment.
  await b
    .waitForFunction(([id, x, z]) => {
      const p = window.app.game.players.find((q) => q.id === id);
      return p && Math.hypot(p.origin.x - x, p.origin.z - z) < 40;
    }, [id, mine[0], mine[1]], { timeout: 10000 })
    .catch(() => {});
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
