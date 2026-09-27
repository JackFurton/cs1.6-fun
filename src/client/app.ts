import { Game, TICK_DT } from '../game/game';
import type { Player } from '../game/player';
import { MAPS } from '../maps';
import { Hud } from './hud';
import { Input } from './input';
import { Menu, toggleFullscreen } from './menu';
import { Renderer } from './renderer';
import { loadSettings, saveSettings } from './settings';

export class App {
  readonly settings = loadSettings();
  readonly game: Game;
  readonly renderer: Renderer;
  readonly input: Input;
  readonly hud: Hud;
  readonly menu: Menu;
  readonly local: Player;
  private yaw = 0;
  private pitch = 0;
  private acc = 0;
  private last = performance.now();

  constructor(root: HTMLElement, params: URLSearchParams) {
    const mapName = params.get('map') ?? 'aim_arena';
    const map = (MAPS[mapName] ?? MAPS.aim_arena)();
    this.game = new Game(map);
    this.renderer = new Renderer(root, this.settings, map);
    this.input = new Input(this.renderer.gl.domElement);
    this.hud = new Hud(root, this.settings);
    this.menu = new Menu(root, this.settings);

    this.local = this.game.addPlayer('Player', 'CT', false);
    this.game.spawn(this.local, 0);
    this.yaw = this.local.yaw;

    // Debug camera placement for screenshots: ?pos=x,y,z&yaw=..&pitch=..
    const pos = params.get('pos');
    if (pos) {
      const [x, y, z] = pos.split(',').map(Number);
      this.local.move.origin.set(x, y, z);
      this.local.prevOrigin.set(x, y, z);
      this.yaw = Number(params.get('yaw') ?? 0);
      this.pitch = Number(params.get('pitch') ?? 0);
      this.local.noclip = true;
    }
    if (params.has('nomenu')) this.menu.show(false);

    this.menu.onPlay = () => void this.input.lock(this.settings.rawInput);
    this.menu.onChange = (s) => {
      saveSettings(s);
      this.renderer.applySettings();
      this.hud.applySettings();
    };
    this.input.onLockChange = (locked) => this.menu.show(!locked);
    addEventListener('keydown', (e) => {
      if (e.code === 'F11') {
        e.preventDefault();
        toggleFullscreen();
      }
    });
  }

  start(): void {
    this.renderer.gl.setAnimationLoop(() => this.frame());
  }

  private frame(): void {
    const now = performance.now();
    // Clamp so a background tab doesn't try to simulate minutes of ticks on return.
    const dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;

    // Mouse look is applied every render frame, not every tick, so it tracks the monitor's refresh rate.
    const [dx, dy] = this.input.takeMouse();
    const k = this.settings.sensitivity * 0.022;
    this.yaw -= dx * k;
    this.pitch -= dy * k * (this.settings.invertMouse ? -1 : 1);
    this.pitch = Math.max(-89, Math.min(89, this.pitch));
    this.yaw = ((this.yaw % 360) + 360) % 360;

    this.acc += dt;
    while (this.acc >= TICK_DT) {
      this.buildLocalCmd();
      this.game.tick();
      this.input.endTick();
      this.acc -= TICK_DT;
    }
    this.draw(this.acc / TICK_DT);
  }

  private buildLocalCmd(): void {
    const i = this.input;
    const c = this.local.cmd;
    c.forward = (i.isDown('forward') ? 1 : 0) - (i.isDown('back') ? 1 : 0);
    c.side = (i.isDown('right') ? 1 : 0) - (i.isDown('left') ? 1 : 0);
    c.yaw = this.yaw;
    c.pitch = this.pitch;
    c.jump = i.isDown('jump');
    c.duck = i.isDown('duck');
    c.walk = i.isDown('walk');
    c.attack = i.isDown('attack');
    c.attack2 = i.isDown('attack2');
    c.reload = i.isDown('reload');
    c.use = i.isDown('use');
    i.takePresses();
  }

  private draw(alpha: number): void {
    const p = this.local;
    const x = p.prevOrigin.x + (p.origin.x - p.prevOrigin.x) * alpha;
    const y = p.prevOrigin.y + (p.origin.y - p.prevOrigin.y) * alpha;
    const z = p.prevOrigin.z + (p.origin.z - p.prevOrigin.z) * alpha;
    const vh = p.prevViewHeight + (p.move.viewHeight - p.prevViewHeight) * alpha;
    this.renderer.setView(x, y + vh, z, this.yaw, this.pitch);
    this.renderer.render();
    this.hud.frame(p.move.velocity.length2d());
  }
}
