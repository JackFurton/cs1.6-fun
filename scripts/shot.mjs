// Screenshot the built game headlessly: node scripts/shot.mjs out.png [query] [waitMs] [keys...]
// Steps run in order after the wait: a key to press ("b"), hold:Key, wait:ms, or js:<expression> (needs ?debug).
import { chromium } from 'playwright';
import { preview } from 'vite';

const [out = 'shot.png', query = '', wait = '1500', ...keys] = process.argv.slice(2);
const server = await preview({ preview: { port: 4999, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(`http://localhost:4999/?${query}`);
await page.waitForTimeout(Number(wait));
for (const k of keys) {
  if (k.startsWith('js:')) {
    await page.evaluate(k.slice(3));
    await page.waitForTimeout(150);
  } else if (k.startsWith('wait:')) {
    await page.waitForTimeout(Number(k.slice(5)));
  } else if (k.startsWith('hold:')) {
    await page.keyboard.down(k.slice(5));
    await page.waitForTimeout(300);
  } else {
    await page.keyboard.press(k);
    await page.waitForTimeout(150);
  }
}
await page.screenshot({ path: out });
await browser.close();
await server.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`wrote ${out}`);
