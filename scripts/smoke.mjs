// Boots the built game in headless Chromium, clicks play, fires for a few seconds, and fails on any page error.
import { chromium } from 'playwright';
import { preview } from 'vite';

const scenarios = process.argv.slice(2).length ? process.argv.slice(2) : ['fire&give=ak47&pos=600,1,0&yaw=90&walk'];
const server = await preview({ preview: { port: 4998, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
let failed = false;
for (const q of scenarios) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack ?? e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`http://localhost:4998/?${q}`);
  await page.click('.play');
  await page.waitForTimeout(4000);
  console.log(`${errors.length ? 'FAIL' : 'ok  '} ?${q}`);
  for (const e of errors) console.log('  ' + e);
  failed ||= errors.length > 0;
  await page.close();
}
await browser.close();
await server.close();
process.exit(failed ? 1 : 0);
