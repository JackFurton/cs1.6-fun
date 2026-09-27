import type { Settings } from './settings';

export class Hud {
  readonly el: HTMLDivElement;
  private fps: HTMLDivElement;
  private speed: HTMLDivElement;
  private crosshair: HTMLDivElement;
  private frames = 0;
  private lastFpsTime = performance.now();

  constructor(
    parent: HTMLElement,
    private settings: Settings,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.innerHTML = `
      <div class="crosshair"><i class="t"></i><i class="b"></i><i class="l"></i><i class="r"></i></div>
      <div class="fps"></div>
      <div class="speed"></div>`;
    parent.appendChild(this.el);
    this.fps = this.el.querySelector('.fps')!;
    this.speed = this.el.querySelector('.speed')!;
    this.crosshair = this.el.querySelector('.crosshair')!;
    this.applySettings();
  }

  applySettings(): void {
    this.crosshair.style.setProperty('--cross', this.settings.crosshairColor);
    this.fps.style.display = this.settings.showFps ? 'block' : 'none';
  }

  setCrosshairGap(px: number): void {
    this.crosshair.style.setProperty('--gap', `${px}px`);
  }

  frame(speed: number): void {
    this.frames++;
    const now = performance.now();
    if (now - this.lastFpsTime >= 500) {
      this.fps.textContent = `${Math.round((this.frames * 1000) / (now - this.lastFpsTime))} fps`;
      this.frames = 0;
      this.lastFpsTime = now;
    }
    this.speed.textContent = `${Math.round(speed)}`;
  }
}
