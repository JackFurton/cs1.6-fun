import { DEFAULT_BINDS, type Binds } from './input';
export interface Settings {
  /** Same scale as CS 1.6 `sensitivity` (m_yaw 0.022), so your 1.6 value carries over. */
  sensitivity: number;
  invertMouse: boolean;
  rawInput: boolean;
  /** Horizontal FOV at 4:3; wider screens get more (Hor+), like 1.6 in widescreen. */
  fov: number;
  volume: number;
  announcer: 'classic' | 'chef' | 'off';
  showFps: boolean;
  /** Graphics preset: lightmap detail, antialiasing, and how far to follow high-DPI screens. */
  quality: 'low' | 'medium' | 'high';
  /** Fraction of device pixel ratio to render at. */
  renderScale: number;
  crosshairColor: string;
  /** Static keeps a fixed gap; dynamic opens up with movement and spray like cl_dynamiccrosshair 1. */
  crosshairStyle: 'static' | 'dynamic';
  crosshairSize: number;
  crosshairGap: number;
  crosshairThickness: number;
  crosshairDot: boolean;
  crosshairOutline: boolean;
  binds: Binds;
  /** Your name in network games. */
  name: string;
  /** Last server joined, prefilled on the join screen. */
  lastServer: string;
}

const DEFAULTS: Settings = {
  sensitivity: 2.5,
  invertMouse: false,
  rawInput: true,
  fov: 90,
  volume: 0.6,
  announcer: 'classic',
  showFps: true,
  quality: 'medium',
  renderScale: 1,
  crosshairColor: '#50ff50',
  crosshairStyle: 'static',
  crosshairSize: 6,
  crosshairGap: 3,
  crosshairThickness: 2,
  crosshairDot: false,
  crosshairOutline: true,
  binds: DEFAULT_BINDS,
  name: 'Player',
  lastServer: '',
};

const KEY = 'cs16fun.settings';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Settings> & { wheel?: string };
      const s: Settings = { ...DEFAULTS, ...saved, binds: structuredClone({ ...DEFAULT_BINDS, ...(saved.binds ?? {}) }) };
      // Older saves had a single wheel option instead of bindings.
      if (!saved.binds && saved.wheel) {
        const strip = (a: string[]) => a.filter((c) => c !== 'WheelUp' && c !== 'WheelDown');
        s.binds = { ...s.binds, jump: strip(s.binds.jump), nextweapon: strip(s.binds.nextweapon), prevweapon: strip(s.binds.prevweapon) };
        if (saved.wheel === 'jump') s.binds.jump.push('WheelUp', 'WheelDown');
        else if (saved.wheel === 'weapons') s.binds.nextweapon.push('WheelDown'), s.binds.prevweapon.push('WheelUp');
        else s.binds.jump.push('WheelDown'), s.binds.prevweapon.push('WheelUp');
      }
      return s;
    }
  } catch {
    // Private windows and blocked storage fall back to defaults.
  }
  return { ...DEFAULTS, binds: structuredClone(DEFAULT_BINDS) };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Not fatal, settings just won't persist.
  }
}
