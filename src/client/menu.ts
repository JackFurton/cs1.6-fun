import { ACTION_LABELS, DEFAULT_BINDS, codeLabel, type Action, type Input } from './input';
import type { Settings } from './settings';

export type TeamChoice = 'T' | 'CT' | 'auto' | 'spec';

export interface NewGameOptions {
  map: string;
  mode: 'defuse' | 'dm';
  /** 'choose' shows the team select screen when the page loads. */
  team: TeamChoice | 'choose';
  model: number;
  teammates: number;
  enemies: number;
  difficulty: 'easy' | 'normal' | 'hard' | 'expert';
}

export function readNewGame(params: URLSearchParams, maps: string[]): NewGameOptions {
  const pick = <T extends string>(v: string | null, allowed: readonly T[], d: T): T => (allowed.includes(v as T) ? (v as T) : d);
  const num = (v: string | null, d: number, max = 9) => Math.max(0, Math.min(max, Number.isFinite(Number(v)) && v !== null ? Number(v) : d));
  return {
    map: pick(params.get('map'), maps, maps[0]),
    mode: pick(params.get('mode'), ['defuse', 'dm'] as const, 'defuse'),
    team: pick(params.get('team'), ['T', 'CT', 'auto', 'spec', 'choose'] as const, 'choose'),
    model: num(params.get('model'), -1, 3),
    teammates: num(params.get('teammates'), 4),
    enemies: num(params.get('enemies'), 5),
    difficulty: pick(params.get('difficulty'), ['easy', 'normal', 'hard', 'expert'] as const, 'normal'),
  };
}

export function newGameParams(o: NewGameOptions): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) p.set(k, String(v));
  return p;
}

export interface MapCard {
  name: string;
  image: string;
}

export interface SkinCard {
  name: string;
  blurb: string;
  image: string;
}

type Screen = 'main' | 'newgame' | 'options' | 'keys' | 'team' | 'character' | 'join';

const DIFFS = [
  ['easy', 'Easy'],
  ['normal', 'Normal (~Silver)'],
  ['hard', 'Hard (~Gold Nova)'],
  ['expert', 'Expert'],
] as const;

/** Every menu screen: title/pause, new game, options, team and character select. */
export class Menu {
  readonly el: HTMLDivElement;
  private box: HTMLDivElement;
  screen: Screen | null = 'main';
  /** Whether a match is running (changes "Play" to "Resume"). */
  started = false;
  private pendingTeam: 'T' | 'CT' = 'CT';
  private draft: NewGameOptions;
  onPlay: () => void = () => {};
  /** Set by the app so the bindings screen can grab the next key press. */
  input: Input | null = null;
  private binding: { action: Action; slot: number } | null = null;
  onChange: (s: Settings) => void = () => {};
  onJoin: (team: TeamChoice, model: number) => void = () => {};
  onNewGame: (o: NewGameOptions) => void = () => {};
  /** Lazily rendered character previews, per team. */
  skins: (team: 'T' | 'CT') => SkinCard[] = () => [];

  constructor(
    parent: HTMLElement,
    private settings: Settings,
    private game: NewGameOptions,
    private maps: MapCard[],
  ) {
    this.draft = { ...game };
    this.el = document.createElement('div');
    this.el.className = 'menu';
    this.box = document.createElement('div');
    this.box.className = 'menu-box';
    this.el.appendChild(this.box);
    parent.appendChild(this.el);
    this.el.addEventListener('click', (e) => this.click(e));
    // Number keys pick teams and models, like 1.6's team menu.
    addEventListener('keydown', (e) => {
      if (!this.screen) return;
      const m = /^Digit(\d)$/.exec(e.code);
      if (e.code === 'Escape' && !this.binding && (this.screen === 'newgame' || this.screen === 'options')) this.show('main');
      if (e.code === 'Escape' && !this.binding && this.screen === 'keys') this.show('options');
      if (!m) return;
      const n = Number(m[1]);
      if (this.screen === 'team') {
        const choice = ({ 1: 'T', 2: 'CT', 5: 'auto', 6: 'spec' } as const)[n as 1 | 2 | 5 | 6];
        if (choice) this.pickTeam(choice);
      } else if (this.screen === 'character' && n >= 1 && n <= 5) {
        this.onJoin(this.pendingTeam, n === 5 ? -1 : n - 1);
      }
    });
  }

  get visible(): boolean {
    return this.screen !== null;
  }

  show(screen: Screen | null | boolean): void {
    this.screen = screen === true ? 'main' : screen === false ? null : screen;
    this.el.style.display = this.screen ? 'flex' : 'none';
    if (this.screen) this.render();
  }

  private pickTeam(t: TeamChoice): void {
    if (t === 'T' || t === 'CT') {
      this.pendingTeam = t;
      this.show('character');
    } else {
      this.onJoin(t, -1);
    }
  }

  private click(e: MouseEvent): void {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!t) return;
    const act = t.dataset.act!;
    const val = t.dataset.val ?? '';
    switch (act) {
      case 'play':
        if (this.started) this.onPlay();
        else this.show('team');
        break;
      case 'screen':
        this.show(val as Screen);
        break;
      case 'team':
        this.pickTeam(val as TeamChoice);
        break;
      case 'model':
        this.onJoin(this.pendingTeam, Number(val));
        break;
      case 'map':
        this.draft.map = val;
        this.render();
        break;
      case 'mode':
        this.draft.mode = val as NewGameOptions['mode'];
        this.render();
        break;
      case 'diff':
        this.draft.difficulty = val as NewGameOptions['difficulty'];
        this.render();
        break;
      case 'bots': {
        const [key, delta] = val.split(':') as ['teammates' | 'enemies', string];
        this.draft[key] = Math.max(0, Math.min(9, this.draft[key] + Number(delta)));
        this.render();
        break;
      }
      case 'start':
        this.onNewGame({ ...this.draft, team: 'choose', model: -1 });
        break;
      case 'fullscreen':
        toggleFullscreen();
        break;
      case 'bind': {
        const [action, slot] = val.split(':');
        this.startBinding(action as Action, Number(slot));
        break;
      }
      case 'connect': {
        const addr = (this.box.querySelector('[name=addr]') as HTMLInputElement).value.trim();
        const name = (this.box.querySelector('[name=pname]') as HTMLInputElement).value.trim() || 'Player';
        this.settings.name = name.slice(0, 24);
        this.settings.lastServer = addr;
        this.onChange(this.settings);
        location.search = new URLSearchParams({ connect: addr }).toString();
        break;
      }
      case 'resetbinds':
        this.settings.binds = structuredClone(DEFAULT_BINDS);
        this.onChange(this.settings);
        this.render();
        break;
    }
  }

  private render(): void {
    switch (this.screen) {
      case 'main':
        return this.renderMain();
      case 'newgame':
        return this.renderNewGame();
      case 'options':
        return this.renderOptions();
      case 'team':
        return this.renderTeam();
      case 'character':
        return this.renderCharacter();
      case 'keys':
        return this.renderKeys();
      case 'join':
        return this.renderJoin();
    }
  }

  private renderMain(): void {
    const g = this.game;
    const where = `${g.map} · ${g.mode === 'dm' ? 'Deathmatch' : 'Bomb Defusal'}`;
    this.box.className = 'menu-box main';
    this.box.innerHTML = `
      <h1>cs1.6-fun</h1>
      <div class="sub">${where}</div>
      <button class="big play" data-act="play">${this.started ? 'Resume' : 'Play'}</button>
      <button data-act="screen" data-val="newgame">New Game</button>
      ${this.started ? '' : '<button data-act="screen" data-val="join">Play with Friends</button>'}
      ${this.started ? '<button data-act="screen" data-val="team">Change Team <kbd>M</kbd></button>' : ''}
      <button data-act="screen" data-val="options">Options</button>
      <button data-act="fullscreen">Fullscreen <kbd>Alt+Enter</kbd></button>
      <p class="keys">WASD move · Space / wheel down jump · Ctrl duck · Shift walk · Mouse1 fire · Mouse2 alt fire · R reload · B buy (R in menu: rebuy) · 1-5 weapons · Q last weapon · G drop · E defuse · Z/X/C radio (bots obey) · Tab scores · M team · Esc menu</p>`;
  }

  private renderNewGame(): void {
    const d = this.draft;
    const maps = this.maps
      .map((m) => `<button class="map-card${m.name === d.map ? ' on' : ''}" data-act="map" data-val="${m.name}"><img src="${m.image}" alt=""><span>${m.name}</span></button>`)
      .join('');
    const seg = (act: string, cur: string, opts: readonly (readonly [string, string])[]) =>
      `<div class="seg">${opts.map(([v, l]) => `<button class="${v === cur ? 'on' : ''}" data-act="${act}" data-val="${v}">${l}</button>`).join('')}</div>`;
    const stepper = (key: 'teammates' | 'enemies', label: string) =>
      `<div class="stepper"><span>${label}</span><button data-act="bots" data-val="${key}:-1">−</button><b>${d[key]}</b><button data-act="bots" data-val="${key}:1">+</button></div>`;
    this.box.className = 'menu-box wide';
    this.box.innerHTML = `
      <h2>New Game</h2>
      <div class="maps">${maps}</div>
      <div class="row">${seg('mode', d.mode, [
        ['defuse', 'Bomb Defusal'],
        ['dm', 'Deathmatch'],
      ])}</div>
      <div class="row">${stepper('teammates', 'Bot teammates')}${stepper('enemies', 'Bot enemies')}</div>
      <div class="row">${seg('diff', d.difficulty, DIFFS)}</div>
      <div class="row end"><button data-act="screen" data-val="main">Back</button><button class="big" data-act="start">Start</button></div>`;
  }

  private renderTeam(): void {
    this.box.className = 'menu-box wide';
    this.box.innerHTML = `
      <h2>Select Team</h2>
      <div class="teams">
        <button class="team-card T" data-act="team" data-val="T"><kbd>1</kbd><b>Terrorists</b><span>Plant the bomb or eliminate the Counter-Terrorists.</span></button>
        <button class="team-card CT" data-act="team" data-val="CT"><kbd>2</kbd><b>Counter-Terrorists</b><span>Defend the bomb sites and defuse if it goes down.</span></button>
      </div>
      <div class="row"><button data-act="team" data-val="auto"><kbd>5</kbd> Auto-select</button><button data-act="team" data-val="spec"><kbd>6</kbd> Spectate bots</button>${this.started ? '<span class="note">Changing team restarts the match.</span>' : ''}</div>
      ${this.started ? '<div class="row end"><button data-act="screen" data-val="main">Back</button></div>' : ''}`;
  }

  private renderCharacter(): void {
    const t = this.pendingTeam;
    const cards = this.skins(t)
      .map((s, i) => `<button class="skin-card ${t}" data-act="model" data-val="${i}"><kbd>${i + 1}</kbd><img src="${s.image}" alt=""><b>${s.name}</b><span>${s.blurb}</span></button>`)
      .join('');
    this.box.className = 'menu-box wide';
    this.box.innerHTML = `
      <h2>${t === 'T' ? 'Terrorist' : 'Counter-Terrorist'} Model</h2>
      <div class="skins">${cards}</div>
      <div class="row end"><button data-act="screen" data-val="team">Back</button><button data-act="model" data-val="-1"><kbd>5</kbd> Auto-select</button></div>`;
  }

  /** Waits for the next key, mouse button or wheel notch and binds it, 1.6 style: a key does one thing. */
  private startBinding(action: Action, slot: number): void {
    if (!this.input) return;
    this.binding = { action, slot };
    this.render();
    this.input.capture = (code) => {
      this.input!.capture = null;
      const b = this.binding!;
      this.binding = null;
      if (code === 'Escape') return this.render();
      const binds = structuredClone(this.settings.binds);
      const list = [...(binds[b.action] ?? [])];
      if (code === 'Backspace' || code === 'Delete') list.splice(b.slot, 1);
      else {
        for (const a of Object.keys(binds) as Action[]) binds[a] = binds[a].filter((c) => c !== code);
        const cur = binds[b.action];
        cur[Math.min(b.slot, cur.length)] = code;
        binds[b.action] = cur;
        this.settings.binds = binds;
        this.onChange(this.settings);
        return this.render();
      }
      binds[b.action] = list;
      this.settings.binds = binds;
      this.onChange(this.settings);
      this.render();
    };
  }

  private renderJoin(): void {
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    this.box.className = 'menu-box';
    this.box.innerHTML = `
      <h2>Play with Friends</h2>
      <div class="settings">
        <label>Your name <input name="pname" type="text" maxlength="24" value="${esc(this.settings.name)}"></label>
        <label>Server address <input name="addr" type="text" placeholder="192.168.1.20" value="${esc(this.settings.lastServer)}"></label>
      </div>
      <p class="note">To host: run <code>./play.sh host</code> (or <code>./play.sh host de_mirage</code>). It prints the address friends should type here, and they can also just open it in a browser. Port 27015 has to be reachable: same Wi-Fi works as-is; over the internet use Tailscale/ZeroTier or forward the port.</p>
      <div class="row end"><button data-act="screen" data-val="main">Back</button><button class="big" data-act="connect">Join</button></div>`;
  }

  private renderKeys(): void {
    const rows = (Object.keys(ACTION_LABELS) as Action[])
      .map((a) => {
        const codes = this.settings.binds[a] ?? [];
        const slot = (i: number) => {
          const waiting = this.binding?.action === a && this.binding.slot === i;
          const label = waiting ? 'Press a key…' : codes[i] ? codeLabel(codes[i]) : '—';
          return `<button class="bind${waiting ? ' waiting' : ''}" data-act="bind" data-val="${a}:${i}">${label}</button>`;
        };
        return `<div class="bind-row"><span>${ACTION_LABELS[a]}</span>${slot(0)}${slot(1)}</div>`;
      })
      .join('');
    this.box.className = 'menu-box wide';
    this.box.innerHTML = `
      <h2>Key Bindings</h2>
      <p class="note">Click a slot, then press a key, mouse button or wheel notch. Esc cancels, Backspace clears. A key can only do one thing, like 1.6's bind.</p>
      <div class="binds">${rows}</div>
      <div class="row end"><button data-act="resetbinds">Reset to defaults</button><button data-act="screen" data-val="options">Back</button></div>`;
  }

  private renderOptions(): void {
    this.box.className = 'menu-box';
    this.box.innerHTML = `
      <h2>Options</h2>
      <div class="settings">
        <label>Sensitivity <input name="sensitivity" type="number" step="0.05" min="0.05" max="20"></label>
        <label>FOV (4:3 horizontal) <input name="fov" type="number" step="1" min="70" max="120"></label>
        <label>Volume <input name="volume" type="range" min="0" max="1" step="0.05"></label>
        <label>Announcer <select name="announcer"><option value="classic">Classic radio</option><option value="chef">Angry chef</option><option value="off">Off</option></select></label>
        <label>Render scale <input name="renderScale" type="range" min="0.5" max="1" step="0.05"></label>
        <label><input name="rawInput" type="checkbox"> Raw mouse input</label>
        <label><input name="invertMouse" type="checkbox"> Invert mouse</label>
        <label><input name="showFps" type="checkbox"> Show FPS</label>
        <label>Graphics (reload) <select name="quality"><option value="low">Low (weak laptops)</option><option value="medium">Medium</option><option value="high">High</option></select></label>
        <label>Crosshair <select name="crosshairStyle"><option value="static">Static</option><option value="dynamic">Dynamic</option></select></label>
        <label>Crosshair colour <input name="crosshairColor" type="color"></label>
        <label>Crosshair size <input name="crosshairSize" type="range" min="2" max="16" step="1"></label>
        <label>Crosshair gap <input name="crosshairGap" type="range" min="-2" max="12" step="1"></label>
        <label>Crosshair thickness <input name="crosshairThickness" type="range" min="1" max="4" step="1"></label>
        <label><input name="crosshairDot" type="checkbox"> Centre dot</label>
        <label><input name="crosshairOutline" type="checkbox"> Outline</label>
      </div>
      <div class="row end"><button data-act="screen" data-val="keys">Key bindings</button><button data-act="fullscreen">Toggle fullscreen (F11 / Alt+Enter)</button><button data-act="screen" data-val="main">Back</button></div>`;
    for (const input of this.box.querySelectorAll<HTMLInputElement | HTMLSelectElement>('.settings input, .settings select')) {
      const key = input.name as keyof Settings;
      if (input instanceof HTMLInputElement && input.type === 'checkbox') input.checked = Boolean(this.settings[key]);
      else input.value = String(this.settings[key]);
      input.addEventListener('input', () => {
        const v = input instanceof HTMLSelectElement ? input.value : input.type === 'checkbox' ? input.checked : input.type === 'color' ? input.value : Number(input.value);
        (this.settings as unknown as Record<string, unknown>)[key] = v;
        this.onChange(this.settings);
      });
    }
  }
}

export function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen();
  else
    void document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(() => {
      // Ctrl is duck, so Ctrl+W/Ctrl+S would otherwise close or save the tab mid-fight.
      // Keyboard Lock (Chrome/Edge, fullscreen only) hands those combos to the page instead.
      const kb = (navigator as Navigator & { keyboard?: { lock?: () => Promise<void> } }).keyboard;
      return kb?.lock?.();
    });
}
