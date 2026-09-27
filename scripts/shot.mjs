// Screenshot the built game headlessly: node scripts/shot.mjs [out.png] [query] [waitMs]
import { chromium } from 'playwright';
import { preview } from 'vite';

const [out = 'shot.png', query = '', wait = '1500'] = process.argv.slice(2);
const server = await preview({ preview: { port: 4999, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(`http://localhost:4999/?${query}`);
await page.waitForTimeout(Number(wait));
await page.screenshot({ path: out });
await browser.close();
await server.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`wrote ${out}`);
