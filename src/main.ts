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
  note.textContent = 'Connecting…';
  root.appendChild(note);
  const url = serverUrl(params.get('connect') ?? '');
  connect(url)
    .then(({ ws, info }) => {
      note.remove();
      params.set('map', info.map);
      params.set('mode', info.mode);
      run(new App(root, params, { ws, info }));
    })
    .catch((err: Error) => {
      note.innerHTML = `${err.message}.<br><a href="./">Back to the menu</a>`;
    });
} else {
  run(new App(root, params));
}
