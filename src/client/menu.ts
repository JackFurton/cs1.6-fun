import type { Settings } from './settings';

export interface NewGameOptions {
  map: string;
  mode: 'defuse' | 'dm';
  team: 'T' | 'CT' | 'auto' | 'spec';
  teammates: number;
  enemies: number;
  difficulty: 'easy' | 'normal' | 'hard' | 'expert';
}

export function readNewGame(params: URLSearchParams, maps: string[]): NewGameOptions {
  const pick = <T extends string>(v: string | null, allowed: readonly T[], d: T): T => (allowed.includes(v as T) ? (v as T) : d);
  const num = (v: string | null, d: number) => Math.max(0, Math.min(9, Number.isFinite(Number(v)) && v !== null ? Number(v) : d));
  return {
    map: pick(params.get('map'), maps, maps[0]),
    mode: pick(params.get('mode'), ['defuse', 'dm'] as const, 'defuse'),
    team: pick(params.get('team'), ['T', 'CT', 'auto', 'spec'] as const, 'CT'),
    teammates: num(params.get('teammates'), 4),
    enemies: num(params.get('enemies'), 5),
    difficulty: pick(params.get('difficulty'), ['easy', 'normal', 'hard', 'expert'] as const, 'normal'),
  };
}

/** Pause/start overlay with settings. Shown whenever the pointer isn't locked. */
export class Menu {
  readonly el: HTMLDivElement;
  onPlay: () => void = () => {};
  onChange: (s: Settings) => void = () => {};

  constructor(
    parent: HTMLElement,
    private settings: Settings,
    game: NewGameOptions,
    maps: string[],
  ) {
    this.el = document.createElement('div');
    this.el.className = 'menu';
    this.el.innerHTML = `
      <div class="menu-box">
        <h1>cs1.6-fun</h1>
        <button class="play">Click to play</button>
        <details class="newgame">
          <summary>New game</summary>
          <div class="settings">
            <label>Map <select name="map">${maps.map((m) => `<option>${m}</option>`).join('')}</select></label>
            <label>Mode <select name="mode"><option value="defuse">Bomb defusal</option><option value="dm">Deathmatch</option></select></label>
            <label>Team <select name="team"><option value="CT">Counter-Terrorist</option><option value="T">Terrorist</option><option value="auto">Auto</option><option value="spec">Spectate bots</option></select></label>
            <label>Bot skill <select name="difficulty"><option value="easy">Easy</option><option value="normal">Normal</option><option value="hard">Hard</option><option value="expert">Expert</option></select></label>
            <label>Teammates <input name="teammates" type="number" min="0" max="9"></label>
            <label>Enemies <input name="enemies" type="number" min="0" max="9"></label>
          </div>
          <button class="start">Start new game</button>
        </details>
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

    const ng = this.el.querySelector('.newgame')!;
    for (const el of ng.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')) el.value = String(game[el.name as keyof NewGameOptions]);
    this.el.querySelector('.start')!.addEventListener('click', () => {
      const params = new URLSearchParams();
      for (const el of ng.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')) params.set(el.name, el.value);
      location.search = params.toString();
    });

    for (const input of this.el.querySelectorAll<HTMLInputElement>('.menu-box > .settings input')) {
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
