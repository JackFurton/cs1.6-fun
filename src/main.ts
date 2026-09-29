import { App } from './client/app';
import { connect, serverUrl } from './client/netclient';
import { showMapView } from './client/minimap';
import { MAPS } from './maps';
import './style.css';

const params = new URLSearchParams(location.search);
const root = document.getElementById('app')!;
const view = params.get('mapview');

function run(app: App): void {
  app.start();
  // Lets headless scripts poke at the game state.
  if (params.has('debug')) (window as unknown as { app: App }).app = app;
}

if (view && MAPS[view]) {
  document.body.style.overflow = 'auto';
  const map = MAPS[view]();
  const canvas = showMapView(root, map);
  if (params.has('nav')) void import('./client/navdebug').then((m) => m.drawNav(canvas, map));
} else if (params.has('connect')) {
  // Network game: find out which map the server runs before building the world.
  const note = document.createElement('div');
  note.className = 'connecting';
  note.textContent = 'Connecting… (up to 10 seconds)';
  root.appendChild(note);
  Promise.resolve().then(() => connect(serverUrl(params.get('connect') ?? '')))
    .then(({ ws, info }) => {
      note.remove();
      params.set('map', info.map);
      params.set('mode', info.mode);
      run(new App(root, params, { ws, info }));
    })
    .catch((err: Error) => {
      const message = document.createElement('p');
      message.textContent = err.message;
      const help = document.createElement('p');
      help.textContent = 'Friends on another network need a public or tunnel link. A 192.168.x.x address only works on the host’s local network.';
      const back = document.createElement('a');
      back.href = './';
      back.textContent = 'Back to the menu';
      note.replaceChildren(message, help, back);
    });
} else {
  run(new App(root, params));
}
