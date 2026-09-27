import { App } from './client/app';
import { showMapView } from './client/minimap';
import { MAPS } from './maps';
import './style.css';

const params = new URLSearchParams(location.search);
const root = document.getElementById('app')!;
const view = params.get('mapview');
if (view && MAPS[view]) {
  document.body.style.overflow = 'auto';
  const map = MAPS[view]();
  const canvas = showMapView(root, map);
  if (params.has('nav')) void import('./client/navdebug').then((m) => m.drawNav(canvas, map));
} else {
  const app = new App(root, params);
  app.start();
  // Lets headless scripts poke at the game state.
  if (params.has('debug')) (window as unknown as { app: App }).app = app;
}
