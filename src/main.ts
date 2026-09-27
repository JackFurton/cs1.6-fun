import { App } from './client/app';
import './style.css';

const app = new App(document.getElementById('app')!, new URLSearchParams(location.search));
app.start();
