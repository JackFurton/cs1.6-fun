// Dedicated server: `node dist-server/main.js --map de_dust2 --port 27015`.
// Serves the built game over HTTP and runs the match over WebSocket on the same port,
// so friends just open http://<your-ip>:27015 in a browser.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Difficulty } from '../bots/skill';
import { MAPS } from '../maps';
import { DEFAULT_PORT, type ClientMsg, type ServerMsg } from '../net/protocol';
import { Room, type Client } from './room';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const port = Number(arg('port', String(DEFAULT_PORT)));
const map = arg('map', 'de_dust2');
const mode = arg('mode', 'defuse') === 'dm' ? 'dm' : 'defuse';
const difficulty = arg('difficulty', 'normal') as Difficulty;
const teamSize = Number(arg('teamsize', '5'));
const dist = resolve(arg('dist', 'dist'));

if (!MAPS[map]) {
  console.error(`Unknown map ${map}. Maps: ${Object.keys(MAPS).join(', ')}`);
  process.exit(1);
}

const room = new Room({ map, mode, difficulty, teamSize });

const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.svg': 'image/svg+xml' };

const http = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  let file = normalize(join(dist, decodeURIComponent(url.pathname)));
  if (!file.startsWith(dist)) return void res.writeHead(403).end();
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) return void res.writeHead(404).end('not found');
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ server: http });
wss.on('connection', (ws: WebSocket) => {
  const client: Client = {
    send(msg: ServerMsg) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    },
  };
  room.connect(client);
  ws.on('message', (data) => {
    try {
      room.receive(client, JSON.parse(String(data)) as ClientMsg);
    } catch {
      // Ignore malformed messages rather than dropping the whole game.
    }
  });
  ws.on('close', () => room.disconnect(client));
});

// Fixed 100Hz tick against the wall clock, catching up if the event loop was busy.
let acc = 0;
let last = performance.now();
setInterval(() => {
  const now = performance.now();
  acc += Math.min(0.25, (now - last) / 1000);
  last = now;
  while (acc >= 0.01) {
    room.tick();
    acc -= 0.01;
  }
}, 4);

http.listen(port, () => {
  const ips = Object.values(networkInterfaces())
    .flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n!.address);
  console.log(`cs1.6-fun server: ${map} (${mode}, ${difficulty} bots) on port ${port}`);
  for (const ip of ['localhost', ...ips]) console.log(`  join at http://${ip}:${port}/?connect`);
});
