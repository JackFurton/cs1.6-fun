import { App } from './client/app';
import { showMapView } from './client/minimap';
import { MAPS } from './maps';
import './style.css';

const params = new URLSearchParams(location.search);
const root = document.getElementById('app')!;
const view = params.get('mapview');
if (view && MAPS[view]) {
  document.body.style.overflow = 'auto';
  showMapView(root, MAPS[view]());
} else {
  new App(root, params).start();
}
