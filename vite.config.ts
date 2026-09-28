import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const SOUNDS = 'public/sounds';

function listSounds(): string[] {
  if (!existsSync(SOUNDS)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(wav|mp3|ogg)$/i.test(name)) out.push(relative(SOUNDS, p).replaceAll('\\', '/').toLowerCase());
    }
  };
  walk(SOUNDS);
  return out;
}

/**
 * Serves sounds/manifest.json listing whatever sound files sit in public/sounds, so the game only
 * requests files that exist (a 404 per missing 1.6 sound would spam the console).
 */
function soundManifest(): Plugin {
  return {
    name: 'sound-manifest',
    configureServer(server) {
      server.middlewares.use('/sounds/manifest.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(listSounds()));
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'sounds/manifest.json', source: JSON.stringify(listSounds()) });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [soundManifest()],
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  server: { host: true },
  preview: { host: true },
});
