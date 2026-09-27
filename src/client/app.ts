import * as THREE from 'three';
import { dummyThink } from '../bots/dummy';
import { Trace } from '../engine/trace';
import { DEG, Vec3, angleVectors } from '../engine/vec';
import { currentSpread } from '../game/combat';
import { Deathmatch } from '../game/deathmatch';
import type { GameEvent } from '../game/events';
import { DroppedWeapon, Game, TICK_DT } from '../game/game';
import type { GameMode } from '../game/mode';
import type { Player } from '../game/player';
import { BombDefusal, DEFUSE_TIME, DEFUSE_TIME_KIT, PLANT_TIME } from '../game/rules';
import type { Slot, WeaponId } from '../game/weapons';
import { WEAPONS } from '../game/weapons';
import { MAPS } from '../maps';
import type { Team } from '../maps/types';
import { Audio } from './audio';
import { BuyMenu } from './buymenu';
import { Effects } from './effects';
import { Hud } from './hud';
import { Input, type Action } from './input';
import { Menu, readNewGame, toggleFullscreen, type NewGameOptions } from './menu';
import { PlayerModel } from './playermodel';
import { Radar } from './radar';
import { Renderer } from './renderer';
import { Scoreboard } from './scoreboard';
import { loadSettings, saveSettings } from './settings';
import { ViewModel } from './viewmodel';
import { buildWeaponModel } from './weaponmodel';

const SLOT_ORDER: Slot[] = ['primary', 'secondary', 'knife', 'grenade', 'c4'];
const SLOT_KEYS: Partial<Record<Action, Slot>> = { slot1: 'primary', slot2: 'secondary', slot3: 'knife', slot4: 'grenade', slot5: 'c4' };
const BOT_NAMES = ['Gordon', 'Adrian', 'Barney', 'Otis', 'Kleiner', 'Eli', 'Alyx', 'Breen', 'Vance', 'Shephard', 'Magnusson', 'Grigori', 'Mossman', 'Calhoun', 'Freeman', 'Wallace', 'Cross', 'Laszlo'];
const GO_LINES = ['Go go go!', 'Move out!', "Let's go!", 'Stick together, team.', 'Lock and load.'];

export class App {
  readonly settings = loadSettings();
  readonly game: Game;
  readonly mode: GameMode;
  readonly options: NewGameOptions;
  readonly renderer: Renderer;
  readonly input: Input;
  readonly hud: Hud;
  readonly menu: Menu;
  readonly buyMenu: BuyMenu;
  readonly scoreboard: Scoreboard;
  readonly radar: Radar;
  readonly viewmodel = new ViewModel();
  readonly effects: Effects;
  readonly audio = new Audio();
  readonly local: Player;
  private models = new Map<Player, PlayerModel>();
  private droppedMeshes = new Map<DroppedWeapon, THREE.Object3D>();
  private bombMesh: THREE.Group | null = null;
  private bombLight: THREE.Mesh | null = null;
  private bombBlink = 0;
  private yaw = 0;
  private pitch = 0;
  private acc = 0;
  private last = performance.now();
  /** ?fire holds the trigger, for screenshot tests. */
  private autoFire = false;
  private specTarget: Player | null = null;
  private deathTime = -10;
  private shake = 0;
  private tr = new Trace();

  constructor(root: HTMLElement, params: URLSearchParams) {
    const mapNames = Object.keys(MAPS);
    this.options = readNewGame(params, mapNames);
    const map = MAPS[this.options.map]();
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
    this.scoreboard = new Scoreboard(root);
    this.radar = new Radar(root, map);
    this.buyMenu = new BuyMenu(root);
    this.menu = new Menu(root, this.settings, this.options, mapNames);

    const o = this.options;
    const myTeam: Team = o.team === 'auto' ? (Math.random() < 0.5 ? 'T' : 'CT') : o.team;
    const other: Team = myTeam === 'T' ? 'CT' : 'T';
    this.local = this.game.addPlayer('Player', myTeam, false);
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    for (let i = 0; i < o.teammates; i++) this.game.addPlayer(names.pop()!, myTeam, true);
    for (let i = 0; i < o.enemies; i++) this.game.addPlayer(names.pop()!, other, true);

    this.mode = o.mode === 'dm' ? new Deathmatch(this.game) : new BombDefusal(this.game);
    this.game.rules = this.mode;
    this.mode.start();
    this.yaw = this.local.yaw;

    const give = params.get('give');
    if (give) for (const id of give.split(',')) if (id in WEAPONS) this.game.equip(this.local, id as WeaponId);

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

    this.buyMenu.onBuy = (item) => {
      const err = this.mode.buy(this.local, item);
      if (!err) this.audio.click(null, 900, 0.3);
      return err;
    };
    this.audio.setVolume(this.settings.volume);
    this.menu.onPlay = () => {
      this.audio.unlock();
      void this.input.lock(this.settings.rawInput);
    };
    this.menu.onChange = (s) => {
      saveSettings(s);
      this.audio.setVolume(s.volume);
      this.renderer.applySettings();
      this.hud.applySettings();
    };
    this.input.onLockChange = (locked) => {
      this.menu.show(!locked);
      if (!locked && this.buyMenu.isOpen) this.buyMenu.close();
    };
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

  private get defusal(): BombDefusal | null {
    return this.mode instanceof BombDefusal ? this.mode : null;
  }

  private frame(): void {
    const now = performance.now();
    // Clamp so a background tab doesn't try to simulate minutes of ticks on return.
    const dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;

    // Mouse look is applied every render frame, not every tick, so it tracks the monitor's refresh rate.
    const [dx, dy] = this.input.takeMouse();
    const w = this.local.weapon;
    const zoomFov = this.local.alive && w && w.zoom > 0 && w.def.zoom ? w.def.zoom[w.zoom - 1] : null;
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
      this.acc -= TICK_DT;
    }
    for (const e of this.game.takeEvents()) this.onEvent(e);
    this.draw(this.acc / TICK_DT, dt, zoomFov);
  }

  private buildLocalCmd(): void {
    const i = this.input;
    const p = this.local;
    const c = p.cmd;
    const menuOpen = this.buyMenu.isOpen;
    c.forward = (i.isDown('forward') ? 1 : 0) - (i.isDown('back') ? 1 : 0);
    c.side = (i.isDown('right') ? 1 : 0) - (i.isDown('left') ? 1 : 0);
    c.yaw = this.yaw;
    c.pitch = this.pitch;
    c.jump = i.isDown('jump');
    c.duck = i.isDown('duck');
    c.walk = i.isDown('walk');
    c.attack = (i.isDown('attack') && !menuOpen) || this.autoFire;
    c.attack2 = i.isDown('attack2') && !menuOpen;
    c.reload = i.isDown('reload');
    c.use = i.isDown('use');
    for (const a of i.takePresses()) {
      const slot = SLOT_KEYS[a];
      if (a === 'buy') this.toggleBuy();
      else if (a === 'attack' && !p.alive) this.nextSpecTarget();
      else if (slot) c.slot = slot;
      else if (a === 'lastinv') c.slot = p.lastSlot;
      else if (a === 'drop') c.drop = true;
      else if (a === 'nextweapon' || a === 'prevweapon') c.slot = this.cycleSlot(a === 'nextweapon' ? 1 : -1);
    }
    if (menuOpen && !this.mode.canBuy(p)) this.buyMenu.close();
  }

  private toggleBuy(): void {
    if (this.buyMenu.isOpen) return this.buyMenu.close();
    if (!this.mode.canBuy(this.local)) {
      this.hud.message(this.local.alive ? 'You are not in a buy zone, or buy time is over' : 'You are dead', 1.5);
      return;
    }
    this.buyMenu.open(this.local);
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

  private nextSpecTarget(): void {
    const alive = this.game.players.filter((p) => p.alive && p !== this.local);
    const mates = alive.filter((p) => p.team === this.local.team);
    const pool = mates.length ? mates : alive;
    if (!pool.length) return;
    const i = this.specTarget ? pool.indexOf(this.specTarget) : -1;
    this.specTarget = pool[(i + 1) % pool.length];
  }

  /** Sounds made by the local player play unpanned. */
  private soundPos(p: Player): Vec3 | null {
    return p === this.local ? null : p.eye();
  }

  private onEvent(e: GameEvent): void {
    this.hud.onEvent(e, this.local);
    switch (e.type) {
      case 'shot': {
        this.audio.shot(e.weapon, e.silenced, this.soundPos(e.player));
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
        if (Math.random() < 0.5) this.audio.impact(e.pos, e.tex);
        break;
      case 'blood':
        this.effects.blood(e.pos, e.dir);
        break;
      case 'hurt':
        if (e.group) this.audio.hit(this.soundPos(e.victim), e.group === 'head', e.victim.helmet || e.victim.armor > 0);
        break;
      case 'step':
        this.audio.step(this.soundPos(e.player), e.tex, e.land);
        break;
      case 'reload': {
        const def = WEAPONS[e.weapon];
        this.audio.reload(this.soundPos(e.player), def.shellReload ?? def.reload, !!def.shellReload);
        break;
      }
      case 'empty':
        if (e.player === this.local) this.audio.click(null, 3000, 0.3);
        break;
      case 'draw':
      case 'pickup':
        if (e.player === this.local) this.audio.click(null, 1200, 0.25);
        break;
      case 'zoom':
        if (e.player === this.local) this.audio.click(null, 4000, 0.15);
        break;
      case 'silencer':
        this.audio.click(this.soundPos(e.player), 1000, 0.3, 0.5);
        break;
      case 'knife':
        if (e.player === this.local) this.viewmodel.onKnife();
        this.audio.swoosh(this.soundPos(e.player), e.hit);
        break;
      case 'kill':
        if (e.killer === this.local && e.victim !== this.local && e.headshot) this.audio.ui(1400);
        if (e.victim === this.local) {
          this.deathTime = this.game.time;
          this.specTarget = null;
          if (this.buyMenu.isOpen) this.buyMenu.close();
        }
        break;
      case 'respawn':
        if (e.player === this.local) this.yaw = e.player.yaw;
        break;
      case 'round':
        if (e.phase === 'freeze') {
          this.yaw = this.local.yaw;
          this.pitch = 0;
          this.specTarget = null;
          this.hud.message(`Round ${e.round}`, 2);
        } else if (e.phase === 'live') {
          this.audio.radio(GO_LINES[Math.floor(Math.random() * GO_LINES.length)]);
        } else if (e.phase === 'matchover') {
          const d = this.defusal!;
          const w = d.score.T > d.score.CT ? 'Terrorists' : 'Counter-Terrorists';
          this.hud.message(`${w} win the match ${Math.max(d.score.T, d.score.CT)}-${Math.min(d.score.T, d.score.CT)}!`, 9, '#ffd24a');
        }
        break;
      case 'roundEnd': {
        const text = e.reason === 'bomb' ? 'Target Successfully Bombed!' : e.reason === 'defuse' ? 'Bomb Defused!' : e.winner === 'T' ? 'Terrorists Win!' : 'Counter-Terrorists Win!';
        this.hud.message(text, 4.5, e.winner === 'T' ? '#ff7a5a' : '#8ab8ff');
        this.audio.radio(e.reason === 'defuse' ? 'Bomb has been defused.' : e.winner === 'T' ? 'Terrorists win!' : 'Counter-Terrorists win!');
        break;
      }
      case 'planted':
        this.hud.message('The bomb has been planted!', 3, '#ff7a5a');
        this.audio.radio('The bomb has been planted.');
        break;
      case 'explosion': {
        this.effects.explosion(e.pos, e.big);
        this.audio.explosion(e.pos, e.big);
        const d = this.renderer.camera.position.distanceTo(new THREE.Vector3(e.pos.x, e.pos.y, e.pos.z));
        this.shake = Math.max(this.shake, Math.max(0, 1 - d / 3000) * (e.big ? 1.2 : 0.6));
        break;
      }
      case 'sound':
        if (e.name === 'c4_beep') {
          this.audio.beep(e.pos);
          this.bombBlink = 0.1;
        } else this.audio.click(e.pos, 1500, 0.4);
        break;
    }
  }

  private syncBomb(dt: number): void {
    const b = this.defusal?.bomb;
    if (!b || b.exploded) {
      if (this.bombMesh) {
        this.renderer.scene.remove(this.bombMesh);
        this.bombMesh = null;
      }
      return;
    }
    if (!this.bombMesh) {
      this.bombMesh = buildWeaponModel('c4').group;
      this.bombLight = new THREE.Mesh(new THREE.SphereGeometry(0.8), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
      this.bombLight.position.set(1.5, 1.6, -1.5);
      this.bombMesh.add(this.bombLight);
      this.bombMesh.position.set(b.pos.x, b.pos.y + 1, b.pos.z);
      this.renderer.scene.add(this.bombMesh);
    }
    this.bombBlink -= dt;
    this.bombLight!.visible = this.bombBlink > 0 && !b.defused;
  }

  private draw(alpha: number, dt: number, zoomFov: number | null): void {
    const p = this.local;
    const lerp = (a: number, b: number) => a + (b - a) * alpha;
    this.shake = Math.max(0, this.shake - dt * 1.5);
    const sx = (Math.random() - 0.5) * this.shake * 3;
    const sy = (Math.random() - 0.5) * this.shake * 3;

    let firstPerson = true;
    if (p.alive || this.game.time - this.deathTime < 2) {
      const vh = lerp(p.prevViewHeight, p.move.viewHeight);
      const eyeY = p.alive ? vh : Math.max(12, vh - (this.game.time - this.deathTime) * 100);
      this.renderer.setView(lerp(p.prevOrigin.x, p.origin.x), lerp(p.prevOrigin.y, p.origin.y) + eyeY, lerp(p.prevOrigin.z, p.origin.z), this.yaw + p.punchYaw + sx, this.pitch + p.punchPitch + sy);
      firstPerson = p.alive;
      this.hud.setSpectating(null);
    } else {
      if (!this.specTarget || !this.specTarget.alive) this.nextSpecTarget();
      const t = this.specTarget;
      firstPerson = false;
      if (t) {
        // Chase cam behind the spectated player, pulled in if a wall is in the way.
        const eye = new Vec3(lerp(t.prevOrigin.x, t.origin.x), lerp(t.prevOrigin.y, t.origin.y) + t.move.viewHeight, lerp(t.prevOrigin.z, t.origin.z));
        const f = new Vec3();
        angleVectors(this.yaw, this.pitch, f);
        const want = eye.clone().addScaled(f, -110);
        this.game.world.trace(eye, want, new Vec3(-4, -4, -4), new Vec3(4, 4, 4), this.tr);
        const cam = this.tr.endpos;
        this.renderer.setView(cam.x, cam.y, cam.z, this.yaw, this.pitch);
        this.hud.setSpectating(`Spectating ${t.name}  (Mouse1: next player)`);
      }
    }
    this.renderer.setZoom(firstPerson ? zoomFov : null);
    const cam = this.renderer.camera;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    this.audio.setListener(cam.position.x, cam.position.y, cam.position.z, fwd.x, fwd.y, fwd.z);

    for (const other of this.game.players) {
      let m = this.models.get(other);
      if (!m) {
        m = new PlayerModel(other.team);
        this.models.set(other, m);
        this.renderer.scene.add(m.root);
      }
      const hidden = other === p && (p.alive || this.game.time - this.deathTime < 2);
      m.root.visible = !hidden;
      if (hidden) continue;
      m.update(other, lerp(other.prevOrigin.x, other.origin.x), lerp(other.prevOrigin.y, other.origin.y), lerp(other.prevOrigin.z, other.origin.z), dt, this.game.time);
    }
    this.syncDropped();
    this.syncBomb(dt);

    const w = p.weapon;
    const scoped = firstPerson && !!zoomFov && !!w && (w.def.zoom?.length ?? 0) > 1;
    this.viewmodel.update(p, this.game.time, dt, scoped, !!w?.silenced);
    this.effects.update(dt);
    this.renderer.render(firstPerson ? this.viewmodel : undefined);

    // Crosshair gap in pixels from the current spread, like cl_dynamiccrosshair.
    let spreadPx = 0;
    if (w && w.def.clip > 0) {
      const spread = currentSpread(p, w);
      const vfov = this.renderer.camera.fov * DEG;
      spreadPx = Math.min(80, (spread / Math.tan(vfov / 2)) * (innerHeight / 2) * 0.6);
    }
    this.hud.update(p, spreadPx, scoped, dt);
    this.updateRoundHud();
    const d = this.defusal;
    const bomb = p.team === 'T' && d ? (d.bomb?.pos ?? d.looseC4) : null;
    this.radar.draw(new Vec3(cam.position.x, 0, cam.position.z), this.yaw, p, this.game.players, bomb);
    const title = `${this.options.map}  ·  ${this.defusal ? `Round ${this.defusal.round}` : 'Deathmatch'}`;
    this.scoreboard.show(this.input.isDown('scores') || this.defusal?.phase === 'matchover', this.game.players, this.defusal?.score ?? null, title, p);
  }

  private updateRoundHud(): void {
    const d = this.defusal;
    const p = this.local;
    if (!d) {
      this.hud.setRound(null, null);
      this.hud.setProgress(null, 0);
      this.hud.setIcons(p.alive, 'none', false);
      return;
    }
    // 1.6 hides the round clock once the bomb is down.
    this.hud.setRound(d.bomb ? null : d.phase === 'freeze' ? Math.max(0, d.phaseEnd - this.game.time) : d.timeLeft, d.score);
    if (d.planter === p) this.hud.setProgress('Planting the bomb...', 1 - (d.plantEnd - this.game.time) / PLANT_TIME);
    else if (d.bomb?.defuser === p) {
      const total = p.defuser ? DEFUSE_TIME_KIT : DEFUSE_TIME;
      this.hud.setProgress('Defusing the bomb...', 1 - (d.bomb.defuseEnd - this.game.time) / total);
    } else this.hud.setProgress(null, 0);
    const c4 = p.weapons.c4 ? (d.siteAt(p.origin) ? 'site' : 'carry') : 'none';
    this.hud.setIcons(d.canBuy(p), c4, p.defuser);
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
        if (d.state.def.id !== 'c4') mesh.rotation.z = Math.PI / 2;
        this.droppedMeshes.set(d, mesh);
        this.renderer.scene.add(mesh);
      }
      mesh.position.set(d.pos.x, d.pos.y + 2, d.pos.z);
      mesh.rotation.y = d.yaw * DEG;
    }
  }
}
