// Starts the local game server and a temporary HTTPS/WebSocket link, with no router changes.
// Only the game server's HTTP/WebSocket port is tunneled.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const args = process.argv.slice(2);
const portArg = args.indexOf('--port');
const port = portArg < 0 ? 27015 : Number(args[portArg + 1]);
const children = [];
let closing = false;
let temp;

function stop(code = 0) {
  if (closing) return;
  closing = true;
  process.exitCode = code;
  for (const child of children) child.kill();
}

process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
process.on('exit', () => { for (const child of children) child.kill(); });

function works(binary) {
  return spawnSync(binary, ['--version'], { timeout: 5000, stdio: 'ignore', windowsHide: true }).status === 0;
}

async function cloudflared() {
  if (process.env.CLOUDFLARED) {
    if (!works(process.env.CLOUDFLARED)) throw new Error('CLOUDFLARED does not point to a working cloudflared executable.');
    return process.env.CLOUDFLARED;
  }
  if (works('cloudflared')) return 'cloudflared';
  const os = { darwin: 'darwin', linux: 'linux', win32: 'windows' }[process.platform];
  const arch = { x64: 'amd64', arm64: 'arm64' }[process.arch];
  if (!os || !arch) throw new Error('Install cloudflared for this platform, then run this command again: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/');
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const binary = join(root, '.host-tools', `cloudflared-${os}-${arch}${suffix}`);
  if (existsSync(binary) && works(binary)) return binary;
  const assetName = `cloudflared-${os}-${arch}${process.platform === 'darwin' ? '.tgz' : suffix}`;
  console.log(`Downloading the official Cloudflare tunnel tool (${os}/${arch})…`);
  const releaseResponse = await fetch('https://api.github.com/repos/cloudflare/cloudflared/releases/latest', { headers: { 'User-Agent': 'cs16-fun-host' }, signal: AbortSignal.timeout(30000) });
  if (!releaseResponse.ok) throw new Error(`Cloudflare release lookup failed (HTTP ${releaseResponse.status}).`);
  const release = await releaseResponse.json();
  const asset = release.assets.find((a) => a.name === assetName);
  if (!asset) throw new Error(`No official ${assetName} binary was found. Install cloudflared manually and retry.`);
  const response = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Tunnel tool download failed (HTTP ${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (asset.digest?.startsWith('sha256:') && `sha256:${createHash('sha256').update(bytes).digest('hex')}` !== asset.digest) throw new Error('Tunnel tool checksum did not match the official release.');
  await mkdir(dirname(binary), { recursive: true });
  if (process.platform === 'darwin') {
    const archive = join(temp, assetName);
    await writeFile(archive, bytes);
    const unpack = spawnSync('tar', ['-xzf', archive, '-C', temp, 'cloudflared'], { stdio: 'pipe' });
    if (unpack.status !== 0) throw new Error('Could not unpack cloudflared. Install it with brew install cloudflared.');
    await copyFile(join(temp, 'cloudflared'), binary);
  } else await writeFile(binary, bytes);
  await chmod(binary, 0o755);
  if (!works(binary)) throw new Error('The downloaded tunnel tool could not run on this computer.');
  console.log(`Tunnel tool ready: ${release.tag_name}`);
  return binary;
}

try {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Choose a port from 1 through 65535.');
  if (!existsSync('dist/index.html') || !existsSync('dist-server/main.js')) throw new Error('Build the game first: npm run build && npm run build:server');
  temp = await mkdtemp(join(tmpdir(), 'cs16-tunnel-'));
  const binary = await cloudflared();
  if (closing) throw new Error('Hosting canceled');
  const server = spawn(process.execPath, ['dist-server/main.js', ...args], { stdio: ['inherit', 'pipe', 'inherit'] });
  children.push(server);
  await new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error('The game server did not start within 10 seconds.')), 10000);
    server.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
      if (String(chunk).includes('cs1.6-fun server:')) {
        clearTimeout(timer);
        resolveReady();
      }
    });
    server.on('error', (e) => { clearTimeout(timer); reject(e); });
    server.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`The game server stopped (${code}). If port ${port} is busy, add --port 27016.`));
      stop(code ?? 1);
    });
  });
  // Use our own empty configuration, leaving any existing Cloudflare setup untouched.
  const config = join(temp, 'config.yml');
  await writeFile(config, '{}\n');
  const tunnel = spawn(binary, ['tunnel', '--config', config, '--no-autoupdate', '--protocol', 'http2', '--url', `http://127.0.0.1:${port}`], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  children.push(tunnel);
  let buffer = '';
  let linkShown = false;
  const log = (chunk) => {
    buffer = (buffer + String(chunk)).slice(-16000);
    const match = buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i);
    if (match && !linkShown) {
      linkShown = true;
      console.log(`\nFRIEND LINK: ${match[0]}/?connect\nYOUR LOCAL LINK: http://localhost:${port}/?connect\nKeep this terminal open. Ctrl+C stops hosting.\n`);
    }
    if (/\b(ERR|WRN)\b/.test(String(chunk))) process.stderr.write(chunk);
  };
  tunnel.stdout.on('data', log);
  tunnel.stderr.on('data', log);
  await new Promise((resolveExit, reject) => {
    tunnel.on('error', reject);
    tunnel.on('exit', (code) => {
      if (!closing && code !== 0) reject(new Error(`The tunnel stopped (${code}). Check the internet connection and retry.`));
      else resolveExit();
    });
  });
  stop();
} catch (error) {
  if (!closing) {
    console.error(`Hosting failed: ${error.message}`);
    stop(1);
  }
} finally {
  if (temp) await rm(temp, { recursive: true, force: true });
}
