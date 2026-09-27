export interface Settings {
  /** Same scale as CS 1.6 `sensitivity` (m_yaw 0.022), so your 1.6 value carries over. */
  sensitivity: number;
  invertMouse: boolean;
  rawInput: boolean;
  /** Horizontal FOV at 4:3; wider screens get more (Hor+), like 1.6 in widescreen. */
  fov: number;
  volume: number;
  showFps: boolean;
  antialias: boolean;
  shadows: boolean;
  /** Fraction of device pixel ratio to render at. */
  renderScale: number;
  crosshairColor: string;
}

const DEFAULTS: Settings = {
  sensitivity: 2.5,
  invertMouse: false,
  rawInput: true,
  fov: 90,
  volume: 0.6,
  showFps: true,
  antialias: true,
  shadows: true,
  renderScale: 1,
  crosshairColor: '#50ff50',
};

const KEY = 'cs16fun.settings';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    // Private windows and blocked storage fall back to defaults.
  }
  return { ...DEFAULTS };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Not fatal, settings just won't persist.
  }
}
