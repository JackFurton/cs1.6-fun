import * as THREE from 'three';
import { dummyThink } from '../bots/dummy';
import { DEG, Vec3, angleVectors } from '../engine/vec';
import { currentSpread } from '../game/combat';
import type { GameEvent } from '../game/events';
import { DroppedWeapon, Game, TICK_DT } from '../game/game';
import type { Player } from '../game/player';
import type { Slot, WeaponId } from '../game/weapons';
import { WEAPONS } from '../game/weapons';
import { MAPS } from '../maps';
import { Effects } from './effects';
import { Hud } from './hud';
import { Input, type Action } from './input';
import { Menu, toggleFullscreen } from './menu';
import { PlayerModel } from './playermodel';
import { Renderer } from './renderer';
import { loadSettings, saveSettings } from './settings';
import { ViewModel } from './viewmodel';
import { buildWeaponModel } from './weaponmodel';

const SLOT_ORDER: Slot[] = ['primary', 'secondary', 'knife', 'grenade', 'c4'];
const SLOT_KEYS: Partial<Record<Action, Slot>> = { slot1: 'primary', slot2: 'secondary', slot3: 'knife', slot4: 'grenade', slot5: 'c4' };

export class App {
  readonly settings = loadSettings();
  readonly game: Game;
  readonly renderer: Renderer;
  readonly input: Input;
  readonly hud: Hud;
  readonly menu: Menu;
  readonly viewmodel = new ViewModel();
  readonly effects: Effects;
  readonly local: Player;
  private models = new Map<Player, PlayerModel>();
  private droppedMeshes = new Map<DroppedWeapon, THREE.Object3D>();
  private respawnAt = new Map<Player, number>();
  private yaw = 0;
  private pitch = 0;
  private acc = 0;
  private last = performance.now();
  /** ?fire holds the trigger, for screenshot tests. */
  private autoFire = false;

  constructor(root: HTMLElement, params: URLSearchParams) {
    const mapName = params.get('map') ?? 'aim_arena';
    const map = (MAPS[mapName] ?? MAPS.aim_arena)();
    this.game = new Game(map);
    this.renderer = new Renderer(root, this.settings, map);
    this.effects = new Effects(this.renderer.scene);
    this.renderer.onResize = (w, h) => {
      this.viewmodel.resize(w / h);
      this.effects.setViewportHeight(h);
    };
    this.renderer.resize();
    this.input = new Input(this.renderer.gl.domElement);
    this.hud = new Hud(root, this.settings);
    this.menu = new Menu(root, this.settings);

    this.local = this.game.addPlayer('Player', 'CT', false);
    const bots = Number(params.get('bots') ?? 5);
    const names = ['Gordon', 'Adrian', 'Barney', 'Otis', 'Kleiner', 'Eli', 'Alyx', 'Breen', 'Vance', 'Shephard'];
    for (let i = 0; i < bots; i++) this.game.addPlayer(names[i % names.length], 'T', true);
    this.game.players.forEach((p, i) => this.game.spawn(p, i));
    for (const id of (params.get('give') ?? 'ak47').split(',')) if (id in WEAPONS) this.game.equip(this.local, id as WeaponId);
    for (const p of this.game.players) if (p.isBot) this.game.equip(p, 'ak47');
    this.game.rules = {
      onKill: (_k, victim) => this.respawnAt.set(victim, this.game.time + (victim.isBot ? 2 : 3)),
    };
    this.yaw = this.local.yaw;

    // Debug camera placement for screenshots: ?pos=x,y,z&yaw=..&pitch=..
    const pos = params.get('pos');
    if (pos) {
      const [x, y, z] = pos.split(',').map(Number);
      this.local.move.origin.set(x, y, z);
      this.local.prevOrigin.set(x, y, z);
      this.yaw = Number(params.get('yaw') ?? 0);
      this.pitch = Number(params.get('pitch') ?? 0);
      this.local.noclip = !params.has('walk');
    }
    if (params.has('nomenu')) this.menu.show(false);
    this.autoFire = params.has('fire');

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
    const w = this.local.weapon;
    const zoomFov = w && w.zoom > 0 && w.def.zoom ? w.def.zoom[w.zoom - 1] : null;
    // 1.6 zoom_sensitivity_ratio 1.2: sensitivity scales with the zoomed FOV.
    const zoomScale = zoomFov ? (zoomFov / this.settings.fov) * 1.2 : 1;
    const k = this.settings.sensitivity * 0.022 * zoomScale;
    this.yaw -= dx * k;
    this.pitch -= dy * k * (this.settings.invertMouse ? -1 : 1);
    this.pitch = Math.max(-89, Math.min(89, this.pitch));
    this.yaw = ((this.yaw % 360) + 360) % 360;

    this.acc += dt;
    while (this.acc >= TICK_DT) {
      this.buildLocalCmd();
      for (const p of this.game.players) if (p.isBot && p.alive) dummyThink(p, this.game.time);
      this.game.tick();
      this.input.endTick();
      for (const [p, t] of this.respawnAt) {
        if (this.game.time >= t) {
          this.respawnAt.delete(p);
          this.game.spawn(p, Math.floor(Math.random() * 5));
          if (p.isBot) this.game.equip(p, 'ak47');
          else if (!p.weapons.primary) this.game.equip(p, 'ak47');
          if (p === this.local) this.yaw = p.yaw;
        }
      }
      this.acc -= TICK_DT;
    }
    for (const e of this.game.takeEvents()) this.onEvent(e);
    this.draw(this.acc / TICK_DT, dt, zoomFov);
  }

  private buildLocalCmd(): void {
    const i = this.input;
    const p = this.local;
    const c = p.cmd;
    c.forward = (i.isDown('forward') ? 1 : 0) - (i.isDown('back') ? 1 : 0);
    c.side = (i.isDown('right') ? 1 : 0) - (i.isDown('left') ? 1 : 0);
    c.yaw = this.yaw;
    c.pitch = this.pitch;
    c.jump = i.isDown('jump');
    c.duck = i.isDown('duck');
    c.walk = i.isDown('walk');
    c.attack = i.isDown('attack') || this.autoFire;
    c.attack2 = i.isDown('attack2');
    c.reload = i.isDown('reload');
    c.use = i.isDown('use');
    for (const a of i.takePresses()) {
      const slot = SLOT_KEYS[a];
      if (slot) c.slot = slot;
      else if (a === 'lastinv') c.slot = p.lastSlot;
      else if (a === 'drop') c.drop = true;
      else if (a === 'nextweapon' || a === 'prevweapon') c.slot = this.cycleSlot(a === 'nextweapon' ? 1 : -1);
    }
  }

  private cycleSlot(dir: number): Slot {
    const p = this.local;
    let idx = SLOT_ORDER.indexOf(p.active);
    for (let n = 0; n < SLOT_ORDER.length; n++) {
      idx = (idx + dir + SLOT_ORDER.length) % SLOT_ORDER.length;
      if (p.weapons[SLOT_ORDER[idx]]) return SLOT_ORDER[idx];
    }
    return p.active;
  }

  private onEvent(e: GameEvent): void {
    this.hud.onEvent(e, this.local);
    switch (e.type) {
      case 'shot': {
        if (e.player === this.local) {
          this.viewmodel.onShot();
          const cam = this.renderer.camera;
          const from = new THREE.Vector3(6, -6, -20).applyQuaternion(cam.quaternion).add(cam.position);
          if (Math.random() < 0.3 && !e.silenced) this.effects.tracer(from, e.end);
          if (!e.silenced) this.effects.muzzleLight(from);
        } else {
          const f = new Vec3();
          angleVectors(e.player.yaw, e.player.pitch, f);
          const from = new THREE.Vector3(e.origin.x + f.x * 24, e.origin.y - 6, e.origin.z + f.z * 24);
          if (!e.silenced) {
            this.effects.tracer(from, e.end);
            this.effects.muzzleLight(from);
          }
        }
        break;
      }
      case 'impact':
        this.effects.impact(e.pos, e.normal, e.tex);
        break;
      case 'blood':
        this.effects.blood(e.pos, e.dir);
        break;
      case 'knife':
        if (e.player === this.local) this.viewmodel.onKnife();
        break;
    }
  }

  private draw(alpha: number, dt: number, zoomFov: number | null): void {
    const p = this.local;
    const lerp = (a: number, b: number) => a + (b - a) * alpha;
    const vh = lerp(p.prevViewHeight, p.move.viewHeight);
    const eyeY = p.alive ? vh : 12;
    this.renderer.setView(lerp(p.prevOrigin.x, p.origin.x), lerp(p.prevOrigin.y, p.origin.y) + eyeY, lerp(p.prevOrigin.z, p.origin.z), this.yaw + p.punchYaw, this.pitch + p.punchPitch);
    this.renderer.setZoom(zoomFov);

    for (const other of this.game.players) {
      if (other === p) continue;
      let m = this.models.get(other);
      if (!m) {
        m = new PlayerModel(other.team);
        this.models.set(other, m);
        this.renderer.scene.add(m.root);
      }
      m.update(other, lerp(other.prevOrigin.x, other.origin.x), lerp(other.prevOrigin.y, other.origin.y), lerp(other.prevOrigin.z, other.origin.z), dt, this.game.time);
    }
    this.syncDropped();

    const w = p.weapon;
    const scoped = !!zoomFov && !!w && (w.def.zoom?.length ?? 0) > 1;
    this.viewmodel.update(p, this.game.time, dt, scoped, !!w?.silenced);
    this.effects.update(dt);
    this.renderer.render(this.viewmodel);

    // Crosshair gap in pixels from the current spread, like cl_dynamiccrosshair.
    let spreadPx = 0;
    if (w && w.def.clip > 0) {
      const spread = currentSpread(p, w);
      const vfov = this.renderer.camera.fov * DEG;
      spreadPx = Math.min(80, (spread / Math.tan(vfov / 2)) * (innerHeight / 2) * 0.6);
    }
    this.hud.update(p, spreadPx, scoped, dt);
  }

  private syncDropped(): void {
    const live = new Set(this.game.dropped);
    for (const [d, mesh] of this.droppedMeshes) {
      if (!live.has(d)) {
        this.renderer.scene.remove(mesh);
        this.droppedMeshes.delete(d);
      }
    }
    for (const d of this.game.dropped) {
      let mesh = this.droppedMeshes.get(d);
      if (!mesh) {
        mesh = buildWeaponModel(d.state.def.id).group;
        mesh.rotation.z = Math.PI / 2;
        this.droppedMeshes.set(d, mesh);
        this.renderer.scene.add(mesh);
      }
      mesh.position.set(d.pos.x, d.pos.y + 2, d.pos.z);
      mesh.rotation.y = d.yaw * DEG;
    }
  }
}
