export type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'jump'
  | 'duck'
  | 'walk'
  | 'attack'
  | 'attack2'
  | 'reload'
  | 'use'
  | 'scores'
  | 'buy'
  | 'slot1'
  | 'slot2'
  | 'slot3'
  | 'slot4'
  | 'slot5'
  | 'lastinv'
  | 'drop'
  | 'nextweapon'
  | 'prevweapon'
  | 'chooseteam'
  | 'radio1'
  | 'radio2'
  | 'radio3';

export type Binds = Record<Action, string[]>;

/** 1.6 defaults. Codes are KeyboardEvent.code, plus Mouse0-4 and WheelUp/WheelDown. */
export const DEFAULT_BINDS: Binds = {
  forward: ['KeyW'],
  back: ['KeyS'],
  left: ['KeyA'],
  right: ['KeyD'],
  jump: ['Space', 'WheelDown'],
  duck: ['ControlLeft', 'ControlRight'],
  walk: ['ShiftLeft', 'ShiftRight'],
  attack: ['Mouse0'],
  attack2: ['Mouse2'],
  reload: ['KeyR'],
  use: ['KeyE'],
  scores: ['Tab'],
  buy: ['KeyB'],
  slot1: ['Digit1'],
  slot2: ['Digit2'],
  slot3: ['Digit3'],
  slot4: ['Digit4'],
  slot5: ['Digit5'],
  lastinv: ['KeyQ'],
  drop: ['KeyG'],
  nextweapon: [],
  prevweapon: ['WheelUp'],
  chooseteam: ['KeyM'],
  radio1: ['KeyZ'],
  radio2: ['KeyX'],
  radio3: ['KeyC'],
};

export const ACTION_LABELS: Record<Action, string> = {
  forward: 'Move forward',
  back: 'Move back',
  left: 'Strafe left',
  right: 'Strafe right',
  jump: 'Jump',
  duck: 'Duck',
  walk: 'Walk',
  attack: 'Fire',
  attack2: 'Alt fire / scope',
  reload: 'Reload',
  use: 'Use / defuse',
  scores: 'Scoreboard',
  buy: 'Buy menu',
  slot1: 'Primary weapon',
  slot2: 'Pistol',
  slot3: 'Knife',
  slot4: 'Grenades',
  slot5: 'C4',
  lastinv: 'Last weapon',
  drop: 'Drop weapon',
  nextweapon: 'Next weapon',
  prevweapon: 'Previous weapon',
  chooseteam: 'Change team',
  radio1: 'Radio commands',
  radio2: 'Group radio',
  radio3: 'Radio responses',
};

/** Human-readable name for a bound code. */
export function codeLabel(code: string): string {
  const named: Record<string, string> = { Mouse0: 'Mouse1', Mouse1: 'Mouse3', Mouse2: 'Mouse2', Mouse3: 'Mouse4', Mouse4: 'Mouse5', WheelUp: 'Wheel up', WheelDown: 'Wheel down', Space: 'Space', ControlLeft: 'Ctrl', ControlRight: 'Right Ctrl', ShiftLeft: 'Shift', ShiftRight: 'Right Shift', AltLeft: 'Alt', Tab: 'Tab', CapsLock: 'Caps' };
  if (named[code]) return named[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}

/** Keyboard/mouse state. Held actions are polled per tick; presses are queued so a tap between ticks isn't lost. */
export class Input {
  /** Codes currently held down. */
  private heldCodes = new Set<string>();
  private presses: Action[] = [];
  /** Actions pressed since the last tick, even if already released. */
  private tapped = new Set<Action>();
  private byCode = new Map<string, Action[]>();
  private binds: Binds = DEFAULT_BINDS;
  mouseDX = 0;
  mouseDY = 0;
  locked = false;
  /** Raw wheel movement, for spectator zoom. */
  private wheel = 0;
  /** When set (spectating), the wheel only zooms and never jumps or switches weapons. */
  wheelZoomOnly = false;
  /** While the key-binding screen waits for a key, every press goes here instead. */
  capture: ((code: string) => void) | null = null;
  onLockChange: (locked: boolean) => void = () => {};

  constructor(private readonly target: HTMLElement) {
    this.setBinds(DEFAULT_BINDS);
    // Capture phase, only while rebinding: the key being bound must never also reach the game.
    addEventListener(
      'keydown',
      (e) => {
        if (!this.capture) return;
        e.preventDefault();
        e.stopPropagation();
        this.capture(e.code);
      },
      true,
    );
    // Normal play listens in the bubble phase so the buy and radio menus can claim number keys first.
    addEventListener('keydown', (e) => {
      const acts = this.byCode.get(e.code);
      if (!acts) return;
      if (this.locked || acts.includes('scores')) e.preventDefault();
      if (e.repeat) return;
      this.codeDown(e.code);
    });
    addEventListener('keyup', (e) => this.heldCodes.delete(e.code));
    addEventListener(
      'mousedown',
      (e) => {
        if (this.capture) {
          e.preventDefault();
          e.stopPropagation();
          this.capture(`Mouse${e.button}`);
          return;
        }
        if (e.target !== this.target || !this.locked) return;
        this.codeDown(`Mouse${e.button}`);
      },
      true,
    );
    addEventListener('mouseup', (e) => this.heldCodes.delete(`Mouse${e.button}`));
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener(
      'wheel',
      (e) => {
        if (e.deltaY === 0) return;
        const code = e.deltaY > 0 ? 'WheelDown' : 'WheelUp';
        if (this.capture) {
          this.capture(code);
          return;
        }
        if (!this.locked) return;
        this.wheel += Math.sign(e.deltaY);
        if (this.wheelZoomOnly) return;
        // A wheel notch is a tap: it lands in exactly one tick, so each notch is one jump attempt.
        for (const a of this.byCode.get(code) ?? []) {
          this.tapped.add(a);
          this.presses.push(a);
        }
      },
      { passive: true },
    );
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.target;
      if (!this.locked) this.heldCodes.clear();
      this.onLockChange(this.locked);
    });
    addEventListener('blur', () => this.heldCodes.clear());
  }

  setBinds(binds: Binds): void {
    this.binds = binds;
    this.byCode.clear();
    for (const [a, codes] of Object.entries(binds) as [Action, string[]][]) {
      for (const c of codes) {
        const list = this.byCode.get(c) ?? [];
        list.push(a);
        this.byCode.set(c, list);
      }
    }
  }

  private codeDown(code: string): void {
    this.heldCodes.add(code);
    for (const a of this.byCode.get(code) ?? []) {
      this.tapped.add(a);
      this.presses.push(a);
    }
  }

  async lock(raw: boolean): Promise<void> {
    const el = this.target as HTMLElement & { requestPointerLock(o?: { unadjustedMovement?: boolean }): Promise<void> | void };
    try {
      // unadjustedMovement skips OS mouse acceleration, the equivalent of 1.6's m_rawinput 1.
      await el.requestPointerLock(raw ? { unadjustedMovement: true } : undefined);
    } catch (err) {
      // Some platforms don't support raw movement; retry plain. A missing user gesture fails both.
      if (!raw) throw err;
      await el.requestPointerLock();
    }
  }

  isDown(a: Action): boolean {
    if (this.tapped.has(a)) return true;
    for (const c of this.binds[a] ?? []) if (this.heldCodes.has(c)) return true;
    return false;
  }

  /** Pops queued one-shot presses. */
  takePresses(): Action[] {
    const p = this.presses;
    this.presses = [];
    return p;
  }

  /** Call after each sim tick so taps are seen by exactly one tick. */
  endTick(): void {
    this.tapped.clear();
  }

  takeWheel(): number {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  takeMouse(): [number, number] {
    const d: [number, number] = [this.mouseDX, this.mouseDY];
    this.mouseDX = this.mouseDY = 0;
    return d;
  }
}
