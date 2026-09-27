// Desktop wrapper: serves the built game from dist/ over a custom scheme and opens it in a window.
const { app, BrowserWindow, Menu, net, protocol } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const dist = path.join(__dirname, '..', 'dist');
const args = process.argv.slice(1);

// Vsync caps rAF at the monitor's refresh rate. --uncapped-fps removes the cap for the lowest input latency.
if (args.includes('--uncapped-fps')) {
  app.commandLine.appendSwitch('disable-frame-rate-limit');
  app.commandLine.appendSwitch('disable-gpu-vsync');
}
// Laptops with two GPUs should use the fast one.
app.commandLine.appendSwitch('force_high_performance_gpu');

// ES module scripts don't load reliably from file://, so serve dist/ as app://game/.
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const url = new URL(req.url);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.normalize(path.join(dist, rel));
    if (!file.startsWith(dist)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });

  Menu.setApplicationMenu(null);
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    fullscreen: !args.includes('--windowed'),
    backgroundColor: '#000000',
    title: 'cs1.6-fun',
    webPreferences: { backgroundThrottling: false },
  });
  win.loadURL('app://game/index.html');

  // --smoke: load, run a few seconds, report page errors, quit. Used to check a build without a human.
  if (args.includes('--smoke')) {
    const errors = [];
    win.webContents.on('console-message', (e) => {
      if (e.level === 'error') errors.push(e.message);
    });
    win.webContents.on('did-fail-load', (_e, code, desc) => errors.push(`load failed ${code} ${desc}`));
    setTimeout(async () => {
      const ok = await win.webContents.executeJavaScript('!!document.querySelector("canvas")').catch(() => false);
      console.log(ok && !errors.length ? 'smoke ok' : `smoke FAIL canvas=${ok} ${errors.join(' | ')}`);
      app.exit(ok && !errors.length ? 0 : 1);
    }, 5000);
  }
});

app.on('window-all-closed', () => app.quit());
