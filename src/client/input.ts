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
  | 'prevweapon';

const KEYS: Record<string, Action> = {
  KeyW: 'forward',
  KeyS: 'back',
  KeyA: 'left',
  KeyD: 'right',
  Space: 'jump',
  ControlLeft: 'duck',
  ControlRight: 'duck',
  ShiftLeft: 'walk',
  ShiftRight: 'walk',
  KeyR: 'reload',
  KeyE: 'use',
  Tab: 'scores',
  KeyB: 'buy',
  Digit1: 'slot1',
  Digit2: 'slot2',
  Digit3: 'slot3',
  Digit4: 'slot4',
  Digit5: 'slot5',
  KeyQ: 'lastinv',
  KeyG: 'drop',
};

/** Keyboard/mouse state. Held actions are polled per tick; presses are queued so a tap between ticks isn't lost. */
export class Input {
  private held = new Set<Action>();
  private presses: Action[] = [];
  /** Actions pressed since the last tick, even if already released. */
  private tapped = new Set<Action>();
  mouseDX = 0;
  mouseDY = 0;
  locked = false;
  onLockChange: (locked: boolean) => void = () => {};

  constructor(private readonly target: HTMLElement) {
    addEventListener('keydown', (e) => {
      const a = KEYS[e.code];
      if (!a) return;
      if (this.locked || a === 'scores') e.preventDefault();
      if (e.repeat) return;
      this.down(a);
    });
    addEventListener('keyup', (e) => {
      const a = KEYS[e.code];
      if (a) this.held.delete(a);
    });
    target.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.down(e.button === 2 ? 'attack2' : 'attack');
    });
    addEventListener('mouseup', (e) => this.held.delete(e.button === 2 ? 'attack2' : 'attack'));
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    target.addEventListener(
      'wheel',
      (e) => {
        if (!this.locked) return;
        this.presses.push(e.deltaY > 0 ? 'nextweapon' : 'prevweapon');
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
      if (!this.locked) this.held.clear();
      this.onLockChange(this.locked);
    });
    addEventListener('blur', () => this.held.clear());
  }

  private down(a: Action): void {
    this.held.add(a);
    this.tapped.add(a);
    this.presses.push(a);
  }

  async lock(raw: boolean): Promise<void> {
    const el = this.target as HTMLElement & { requestPointerLock(o?: { unadjustedMovement?: boolean }): Promise<void> | void };
    try {
      // unadjustedMovement skips OS mouse acceleration, the equivalent of 1.6's m_rawinput 1.
      await el.requestPointerLock(raw ? { unadjustedMovement: true } : undefined);
    } catch {
      await el.requestPointerLock();
    }
  }

  isDown(a: Action): boolean {
    return this.held.has(a) || this.tapped.has(a);
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

  takeMouse(): [number, number] {
    const d: [number, number] = [this.mouseDX, this.mouseDY];
    this.mouseDX = this.mouseDY = 0;
    return d;
  }
}
