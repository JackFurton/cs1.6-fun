import type { Settings } from './settings';

/** Pause/start overlay with settings. Shown whenever the pointer isn't locked. */
export class Menu {
  readonly el: HTMLDivElement;
  onPlay: () => void = () => {};
  onChange: (s: Settings) => void = () => {};

  constructor(
    parent: HTMLElement,
    private settings: Settings,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'menu';
    this.el.innerHTML = `
      <div class="menu-box">
        <h1>cs1.6-fun</h1>
        <button class="play">Click to play</button>
        <div class="settings">
          <label>Sensitivity <input name="sensitivity" type="number" step="0.05" min="0.05" max="20"></label>
          <label>FOV (4:3 horizontal) <input name="fov" type="number" step="1" min="70" max="120"></label>
          <label>Volume <input name="volume" type="range" min="0" max="1" step="0.05"></label>
          <label>Render scale <input name="renderScale" type="range" min="0.5" max="1" step="0.05"></label>
          <label><input name="rawInput" type="checkbox"> Raw mouse input</label>
          <label><input name="invertMouse" type="checkbox"> Invert mouse</label>
          <label><input name="showFps" type="checkbox"> Show FPS</label>
          <label><input name="shadows" type="checkbox"> Shadows (reload)</label>
          <label><input name="antialias" type="checkbox"> Antialiasing (reload)</label>
          <label>Crosshair colour <input name="crosshairColor" type="color"></label>
        </div>
        <button class="fullscreen">Toggle fullscreen (F11)</button>
        <p class="keys">WASD move · Space jump · Ctrl duck · Shift walk · Mouse1 fire · Mouse2 alt fire · R reload · B buy · 1-5 weapons · Q last weapon · G drop · E use/defuse · Tab scores · Esc menu</p>
      </div>`;
    parent.appendChild(this.el);

    for (const input of this.el.querySelectorAll<HTMLInputElement>('input')) {
      const key = input.name as keyof Settings;
      if (input.type === 'checkbox') input.checked = Boolean(settings[key]);
      else input.value = String(settings[key]);
      input.addEventListener('input', () => {
        const v = input.type === 'checkbox' ? input.checked : input.type === 'color' ? input.value : Number(input.value);
        (this.settings as unknown as Record<string, unknown>)[key] = v;
        this.onChange(this.settings);
      });
    }
    this.el.querySelector('.play')!.addEventListener('click', () => this.onPlay());
    this.el.querySelector('.fullscreen')!.addEventListener('click', () => toggleFullscreen());
  }

  show(visible: boolean): void {
    this.el.style.display = visible ? 'flex' : 'none';
  }
}

export function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen({ navigationUI: 'hide' });
}
