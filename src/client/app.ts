import * as THREE from 'three';
import { BotManager } from '../bots/manager';
import { Trace } from '../engine/trace';
import { DEG, Vec3, angleDiff, angleVectors } from '../engine/vec';
import { currentSpread } from '../game/combat';
import { Deathmatch } from '../game/deathmatch';
import { AimTournament, TOURNAMENT_PLAYERS } from '../game/tournament';
import type { GameEvent } from '../game/events';
import { DroppedWeapon, Game, TICK_DT } from '../game/game';
import type { BuyItem, GameMode } from '../game/mode';
import { Player } from '../game/player';
import type { ServerInfo } from '../net/protocol';
import { NetClient } from './netclient';
import { BombDefusal, DEFUSE_TIME, DEFUSE_TIME_KIT, PLANT_TIME } from '../game/rules';
import type { Slot, WeaponId } from '../game/weapons';
import { WEAPONS } from '../game/weapons';
import { MAPS } from '../maps';
import type { Team } from '../maps/types';
import { Announcer } from './announcer';
import { Audio } from './audio';
import { ViewBob } from './bob';
import { BuyMenu, owns } from './buymenu';
import { Effects } from './effects';
import { Hud } from './hud';
import { Input, type Action } from './input';
import { Menu, newGameParams, readNewGame, toggleFullscreen, type NewGameOptions, type TeamChoice } from './menu';
import { renderMapImage } from './minimap';
import { skinPreviews } from './previews';
import { SKINS } from './skins';
import { PlayerModel, poseOf } from './playermodel';
import { Radar } from './radar';
import { RadioMenuUI } from './radiomenu';
import { radioText } from '../game/radio';
import { Renderer } from './renderer';
import { Scoreboard } from './scoreboard';
import { SmokeRenderer } from './smokes';
import { loadSettings, saveSettings } from './settings';
import { ViewModel } from './viewmodel';
import { buildWeaponModel } from './weaponmodel';
import { NukeStrike } from './nuke';
import { TournamentPanel } from './tournament';

const SLOT_ORDER: Slot[] = ['primary', 'secondary', 'knife', 'grenade', 'c4'];
const SLOT_KEYS: Partial<Record<Action, Slot>> = { slot1: 'primary', slot2: 'secondary', slot3: 'knife', slot4: 'grenade', slot5: 'c4' };
const BOT_NAMES = ['Gordon', 'Adrian', 'Barney', 'Otis', 'Kleiner', 'Eli', 'Alyx', 'Breen', 'Vance', 'Shephard', 'Magnusson', 'Grigori', 'Mossman', 'Calhoun', 'Freeman', 'Wallace', 'Cross', 'Laszlo'];

export class App {
  readonly settings = loadSettings();
  readonly game: Game;
  mode!: GameMode;
  readonly options: NewGameOptions;
  readonly renderer: Renderer;
  readonly input: Input;
  readonly hud: Hud;
  readonly menu: Menu;
  readonly buyMenu: BuyMenu;
  readonly scoreboard: Scoreboard;
  readonly tournamentPanel: TournamentPanel;
  readonly radar: Radar;
  readonly radioMenu: RadioMenuUI;
  readonly viewmodel = new ViewModel();
  readonly effects: Effects;
  readonly nuke: NukeStrike;
  readonly audio = new Audio();
  readonly announcer = new Announcer(this.audio);
  /** Local player's recent kills, for multi-kill callouts. */
  private killTimes: number[] = [];
  local: Player;
  bots!: BotManager;
  private started = false;
  private orbit = 0;
  private wantTeamMenu = false;
  private models = new Map<Player, PlayerModel>();
  private droppedMeshes = new Map<DroppedWeapon, THREE.Object3D>();
  private nadeMeshes = new Map<object, THREE.Object3D>();
  private smokes!: SmokeRenderer;
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
  private leaveGuard = false;
  private bob = new ViewBob();
  private radarTime = 0;
  private root: HTMLElement;
  private params: URLSearchParams;
  private buyUnlocked = false;
  private purchases: BuyItem[] = [];
  private lastPurchases: BuyItem[] = [];
  private resume: HTMLDivElement;
  private specYaw = 0;
  private specPitch = 0;
  /** 1.6 spectator modes: orbit with the mouse, chase their view, see through their eyes, fly freely. */
  private specMode: 'free' | 'chase' | 'eyes' | 'roam' = 'free';
  private specDist = 150;
  private roamPos = new Vec3();
  private tr = new Trace();
  private lastTournamentPhase = '';

  /** Set when playing on a server; the sim then lives there and this client predicts and draws. */
  readonly net: NetClient | null = null;

  constructor(root: HTMLElement, params: URLSearchParams, remote?: { ws: WebSocket; info: ServerInfo }) {
    const mapNames = Object.keys(MAPS);
    this.options = readNewGame(params, mapNames);
    const map = MAPS[this.options.map]();
    this.game = new Game(map);
    this.renderer = new Renderer(root, this.settings, map);
    this.effects = new Effects(this.renderer.scene);
    this.smokes = new SmokeRenderer(this.renderer.scene);
    this.renderer.gl.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.hud.error('The graphics driver reset (WebGL context lost). Reload the page to continue.');
    });
    this.renderer.onResize = (w, h) => {
      this.viewmodel.resize(w / h);
      this.effects.setViewportHeight(h);
    };
    this.renderer.resize();
    this.input = new Input(this.renderer.gl.domElement);
    this.hud = new Hud(root, this.settings);
    this.nuke = new NukeStrike(this.renderer, root, map);
    this.scoreboard = new Scoreboard(root);
    this.radar = new Radar(root, map);
    this.radioMenu = new RadioMenuUI(root);
    this.radioMenu.onPick = (cmd) => {
      if (!this.started || !this.local.alive) return;
      this.hud.chat(`(RADIO) ${this.local.name}: ${radioText(cmd)}`, this.local.team);
      this.audio.click(null, 1100, 0.15);
      if (this.net) this.net.send({ t: 'radio', cmd });
      else this.bots.command(this.local, cmd);
    };
    this.buyMenu = new BuyMenu(root);
    const cards = mapNames.map((name) => ({ name, image: renderMapImage(MAPS[name](), 256).canvas.toDataURL() }));
    this.menu = new Menu(root, this.settings, this.options, cards);
    this.tournamentPanel = new TournamentPanel(root);
    this.tournamentPanel.onAction = (action) => {
      this.audio.unlock();
      if (this.net) this.net.send(action);
      else if (this.tournament) {
        let error: string | null = null;
        if (action.action === 'duo') error = this.tournament.chooseDuo(this.local, action.duo);
        else if (action.action === 'ready') error = this.tournament.setReady(this.local, action.ready);
        else if (action.action === 'again' && this.tournament.state.phase === 'complete') this.tournament.start();
        if (error) this.tournamentPanel.message(error);
      }
    };
    this.menu.skins = (team) => {
      const imgs = skinPreviews(team);
      return SKINS[team].map((s, i) => ({ name: s.name, blurb: s.blurb, image: imgs[i] ?? '' }));
    };
    // Until someone joins, the local player is a placeholder watching the map.
    this.local = new Player(-1, 'Player', 'CT', false);
    this.local.alive = false;
    this.root = root;
    this.params = params;
    root.classList.add('pregame');
    if (remote) {
      // Network game: rules object mirrors the server's for the HUD and buy checks; it never ticks.
      this.mode = remote.info.mode === 'tournament' ? new AimTournament(this.game) : remote.info.mode === 'dm' ? new Deathmatch(this.game) : new BombDefusal(this.game);
      this.game.rules = this.mode;
      this.net = new NetClient(remote.ws, remote.info, this.game, this.mode);
      this.net.onWelcome = (p) => {
        this.local = p;
        this.yaw = p.yaw;
        this.pitch = 0;
        if (!this.started) {
          this.started = true;
          this.menu.started = true;
          root.classList.remove('pregame');
          this.menu.show(false);
          this.menu.onPlay();
        }
      };
      this.net.onBuyResult = (err) => {
        if (err) {
          this.hud.message(err, 3);
          this.tournamentPanel.message(err);
        }
      };
      this.net.onFull = (reason) => {
        this.menu.show('team');
        this.menu.notice(reason);
      };
      this.net.onRespawn = (p) => {
        this.yaw = p.yaw;
        this.pitch = p.pitch;
        this.specTarget = null;
      };
      this.net.onChat = (from, text) => from && this.hud.chat(`${from.name}: ${text}`, from.team);
      this.net.onClose = () => this.hud.error('Disconnected from the server. Reload to rejoin.');
    } else if (this.options.team !== 'choose') this.startMatch(this.options.team, this.options.model);
    this.menu.show(params.has('nomenu') ? false : 'main');
    this.menu.onJoin = (team, model) => {
      if (this.net) {
        if (team === 'spec') return;
        this.net.send(this.started ? { t: 'team', team, model } : { t: 'hello', name: this.settings.name, team, model });
        this.menu.show(false);
        return;
      }
      if (!this.started) {
        this.startMatch(team, model);
        this.menu.show(false);
        this.menu.onPlay();
        return;
      }
      // Mid-match team changes restart with the same setup.
      location.search = newGameParams({ ...this.options, team, model }).toString();
    };
    this.menu.onNewGame = (o) => {
      location.search = newGameParams(o).toString();
    };
    this.autoFire = params.has('fire');

    this.buyMenu.onBuy = (item) => {
      const err = this.buyItem(item);
      if (!err) {
        this.audio.click(null, 900, 0.3);
        this.purchases.push(item);
      }
      return err;
    };
    this.buyMenu.onRebuy = () => this.rebuy();
    this.buyMenu.priceOf = (item, listed) => (this.defusal && (item === 'vest' || item === 'vesthelm') ? (this.defusal.armorCost(this.local, item) ?? listed) : listed);
    this.buyMenu.timeLeft = () => {
      const d = this.defusal;
      if (!d) return null;
      const end = d.phase === 'freeze' ? d.phaseEnd + d.cfg.buyTime : d.roundStart + d.cfg.buyTime;
      return end - this.game.time;
    };
    this.buyMenu.onClose = (via) => {
      // The menu freed the mouse for clicking; take it back. B or a click count as the user gesture
      // pointer lock needs, but Escape doesn't, and a lock grabbed mid-Escape is dropped straight away,
      // which used to bounce you into the main menu. So after Escape, just ask for a click.
      if (!this.buyUnlocked) return;
      this.buyUnlocked = false;
      if (via === 'esc') this.resume.style.display = 'flex';
      else this.lockAgain();
    };
    this.audio.setVolume(this.settings.volume);
    this.announcer.setPack(this.settings.announcer);
    // Open maps get a short tail, enclosed ones more room.
    this.audio.roominess = map.name === 'de_inferno' || map.name === 'de_cache' ? 0.6 : map.name.startsWith('fy_') ? 0.25 : 0.4;
    this.menu.onPlay = () => {
      // Outside fullscreen the browser won't let the page block Ctrl+W, but it will ask before leaving.
      // Electron has no tabs to lose, and there the guard would silently block closing the window.
      if (!this.leaveGuard && !navigator.userAgent.includes('Electron')) {
        this.leaveGuard = true;
        addEventListener('beforeunload', (e) => {
          e.preventDefault();
          // Older Chromium only shows the prompt when returnValue is set.
          e.returnValue = '';
        });
      }
      this.audio.unlock();
      this.lockAgain();
    };
    this.input.setBinds(this.settings.binds);
    this.menu.input = this.input;
    this.menu.onChange = (s) => {
      saveSettings(s);
      this.input.setBinds(s.binds);
      this.audio.setVolume(s.volume);
      this.announcer.setPack(s.announcer);
      this.renderer.applySettings();
      this.hud.applySettings();
    };
    this.resume = document.createElement('div');
    this.resume.className = 'resume';
    this.resume.innerHTML = '<b>Click to resume</b><span>Esc for menu</span>';
    root.appendChild(this.resume);
    this.resume.addEventListener('click', () => this.lockAgain());
    this.renderer.gl.domElement.addEventListener('mousedown', () => {
      if (!this.input.locked && this.resume.style.display === 'flex') this.lockAgain();
    });
    this.input.onLockChange = (locked) => {
      if (locked) {
        this.menu.show(false);
        this.resume.style.display = 'none';
        return;
      }
      if (this.tournamentInteractive) return;
      // We released the mouse ourselves for the buy menu.
      if (this.buyMenu.isOpen) return;
      if (this.wantTeamMenu) {
        this.wantTeamMenu = false;
        this.menu.show('team');
        return;
      }
      // Esc leaves the page focused; alt-tab doesn't. Only Esc should bring up the full menu,
      // alt-tabbing back just needs a click. Focus settles a moment after the lock is lost.
      setTimeout(() => {
        if (this.input.locked || this.tournamentInteractive) return;
        if (document.hasFocus()) this.menu.show(true);
        else this.resume.style.display = 'flex';
      }, 120);
    };
    addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.resume.style.display === 'flex') {
        this.resume.style.display = 'none';
        this.menu.show(true);
      }
    });
    addEventListener('keydown', (e) => {
      // F11 is taken by macOS for Mission Control, so Alt+Enter (the classic game shortcut) works too.
      if (e.code === 'F11' || (e.code === 'Enter' && e.altKey)) {
        e.preventDefault();
        toggleFullscreen();
      }
    });
  }

  /** Add the players, rules and bots, now that we know which side the human is on. */
  private startMatch(choice: TeamChoice, model: number): void {
    const o = this.options;
    const params = this.params;
    const spectating = choice === 'spec';
    const myTeam: Team = choice === 'T' || choice === 'CT' ? choice : Math.random() < 0.5 ? 'T' : 'CT';
    const other: Team = myTeam === 'T' ? 'CT' : 'T';
    // A spectator is a player object that never joins the game, so it's permanently dead.
    this.local = spectating ? new Player(-1, 'Spectator', myTeam, false) : this.game.addPlayer(this.settings.name, myTeam, false);
    this.local.model = model >= 0 ? model : Math.floor(Math.random() * 4);
    if (spectating) {
      this.local.alive = false;
      this.root.classList.add('spectator');
    }
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    if (o.mode === 'tournament') {
      while (this.game.players.length < TOURNAMENT_PLAYERS) this.game.addPlayer(names.pop()!, this.game.players.length % 2 ? 'T' : 'CT', true).model = Math.floor(Math.random() * 4);
    } else {
      for (let i = 0; i < o.teammates; i++) this.game.addPlayer(names.pop()!, myTeam, true).model = Math.floor(Math.random() * 4);
      for (let i = 0; i < o.enemies; i++) this.game.addPlayer(names.pop()!, other, true).model = Math.floor(Math.random() * 4);
    }

    this.mode = o.mode === 'tournament' ? new AimTournament(this.game) : o.mode === 'dm' ? new Deathmatch(this.game) : new BombDefusal(this.game);
    this.game.rules = this.mode;
    this.mode.start();
    if (spectating && this.mode instanceof AimTournament) this.mode.begin();
    this.bots = new BotManager(this.game, this.mode, o.difficulty);
    this.yaw = this.local.yaw;
    this.pitch = 0;

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
      // The round-start event snaps the view to the player's yaw, so point the player too.
      this.local.yaw = this.yaw;
      this.local.noclip = !params.has('walk');
    }
    this.started = true;
    this.menu.started = true;
    this.root.classList.remove('pregame');
    this.input.takePresses();
    this.last = performance.now();
    this.acc = 0;
  }

  /** Slow circle over the map behind the menus before a match starts. */
  private drawOrbit(dt: number): void {
    this.orbit += dt * 0.05;
    const s = this.game.map.spawns.CT[0].pos;
    const t = this.game.map.spawns.T[0].pos;
    const cx = (s.x + t.x) / 2;
    const cz = (s.z + t.z) / 2;
    const r = Math.max(800, Math.hypot(s.x - t.x, s.z - t.z) * 0.45);
    const x = cx + Math.sin(this.orbit) * r;
    const z = cz + Math.cos(this.orbit) * r;
    const yaw = Math.atan2(x - cx, z - cz) / DEG;
    this.renderer.setView(x, 900, z, yaw, -32);
    this.effects.update(dt);
    this.renderer.render();
  }

  private lockAgain(): void {
    this.resume.style.display = 'none';
    this.menu.show(false);
    if (this.tournamentInteractive) return;
    this.input.lock(this.settings.rawInput).catch(() => {});
    // Without a user gesture the browser refuses; fall back to asking for a click.
    setTimeout(() => {
      if (!this.input.locked && !this.buyMenu.isOpen && !this.tournamentInteractive && this.menu.el.style.display === 'none') this.resume.style.display = 'flex';
    }, 300);
  }

  /** Buying is the server's call in network games; the snapshot brings the result back. */
  private buyItem(item: BuyItem): string | null {
    if (!this.net) return this.mode.buy(this.local, item);
    this.net.send({ t: 'buy', item });
    return null;
  }

  /** Buy last round's loadout again, skipping anything already owned. */
  private rebuy(): string | null {
    const list = this.lastPurchases.length ? this.lastPurchases : this.purchases;
    if (!list.length) return 'Nothing to rebuy yet';
    let err: string | null = null;
    for (const item of list) {
      if (owns(this.local, item)) continue;
      const e = this.buyItem(item);
      if (e) err = e;
      else this.purchases.push(item);
    }
    if (!err) this.audio.click(null, 900, 0.3);
    return err;
  }

  start(): void {
    this.renderer.gl.setAnimationLoop(() => this.frame());
  }

  private get defusal(): BombDefusal | null {
    return this.mode instanceof BombDefusal ? this.mode : null;
  }

  private get tournament(): AimTournament | null {
    return this.mode instanceof AimTournament ? this.mode : null;
  }

  private get tournamentInteractive(): boolean {
    const phase = this.tournament?.state.phase;
    return phase === 'lobby' || phase === 'complete';
  }

  private frame(): void {
    try {
      this.step();
    } catch (err) {
      // Keep the loop alive and show the error so it can be reported, instead of freezing.
      console.error(err);
      this.hud.error(String((err as Error)?.stack ?? err));
    }
  }

  private step(): void {
    const now = performance.now();
    // Clamp so a background tab doesn't try to simulate minutes of ticks on return.
    const dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    if (!this.started) return this.drawOrbit(dt);
    const phase = this.tournament?.state.phase;
    if (phase && phase !== this.lastTournamentPhase) {
      const previous = this.lastTournamentPhase;
      this.lastTournamentPhase = phase;
      if (this.tournamentInteractive) {
        this.menu.show(false);
        this.resume.style.display = 'none';
        if (this.input.locked) document.exitPointerLock();
      } else if (previous === 'lobby') this.lockAgain();
    }

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
      if (this.net) this.net.tick(this.local.cmd);
      else {
        this.bots.update(TICK_DT);
        this.game.tick();
      }
      this.input.endTick();
      this.acc -= TICK_DT;
    }
    for (const e of this.net ? this.net.takeEvents() : this.game.takeEvents()) this.onEvent(e);
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
      else if (a === 'radio1' || a === 'radio2' || a === 'radio3') {
        if (p.alive) this.radioMenu.toggle(Number(a.slice(5)) - 1);
      }
      else if (a === 'chooseteam') {
        if (this.tournament) {
          if (!this.tournamentInteractive) this.hud.message('Teams are locked. Hold Tab to see the bracket.', 3);
          continue;
        }
        this.wantTeamMenu = true;
        if (this.input.locked) document.exitPointerLock();
        else this.menu.show('team');
      }
      else if (a === 'attack' && !p.alive) this.nextSpecTarget(1);
      else if (a === 'attack2' && !p.alive) this.nextSpecTarget(-1);
      else if (a === 'jump' && !p.alive && this.game.time - this.deathTime >= 2) this.cycleSpecMode();
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
      this.hud.message(this.tournament ? 'Aim loadout: AK-47 + Desert Eagle + armor. No buying.' : this.local.alive ? 'You are not in a buy zone, or buy time is over' : 'You are dead', 1.5);
      return;
    }
    this.buyMenu.open(this.local);
    if (this.input.locked) {
      this.buyUnlocked = true;
      document.exitPointerLock();
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

  private cycleSpecMode(): void {
    const modes = ['free', 'chase', 'eyes', 'roam'] as const;
    this.specMode = modes[(modes.indexOf(this.specMode) + 1) % modes.length];
    if (this.specMode === 'roam') this.roamPos.copy(this.renderer.camera.position as unknown as Vec3);
  }

  private nextSpecTarget(dir = 1): void {
    const alive = this.game.players.filter((p) => p.alive && p !== this.local);
    const mates = alive.filter((p) => p.team === this.local.team);
    const pool = mates.length ? mates : alive;
    if (!pool.length) return;
    const i = this.specTarget ? pool.indexOf(this.specTarget) : dir > 0 ? -1 : 0;
    this.specTarget = pool[(i + dir + pool.length) % pool.length];
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
        // 1.6 draws no tracers and only a small flash sprite on the gun itself.
        if (e.player === this.local) this.viewmodel.onShot();
        else if (!e.silenced) {
          const f = new Vec3();
          angleVectors(e.player.yaw, e.player.pitch, f);
          this.effects.muzzleLight(new THREE.Vector3(e.origin.x + f.x * 30, e.origin.y - 8, e.origin.z + f.z * 30));
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
        if (e.killer === this.local && e.victim !== this.local) {
          if (e.headshot) this.audio.ui(1400);
          this.killTimes = this.killTimes.filter((t) => this.game.time - t < 4);
          this.killTimes.push(this.game.time);
          if (this.killTimes.length >= 3) this.announcer.say('multikill', 4);
          else if (e.headshot) this.announcer.say('headshot', 3);
        }
        if (e.victim !== this.local && e.victim.team === this.local.team && this.local.alive && this.defusal?.phase === 'live') {
          const mates = this.game.players.filter((p) => p.team === this.local.team && p.alive);
          if (mates.length === 1) this.announcer.say('lastalive', 30);
        }
        if (e.victim === this.local) {
          this.deathTime = this.game.time;
          this.specTarget = null;
          if (this.buyMenu.isOpen) this.buyMenu.close();
        }
        break;
      case 'grenade':
        if (e.player.team === this.local.team && e.player !== this.local && e.player.isBot) {
          this.hud.chat(`(RADIO) ${e.player.name}: Fire in the hole!`, e.player.team);
          this.announcer.say('fireinhole', 3);
        }
        break;
      case 'flash':
        this.audio.explosion(e.pos, false);
        // The flash itself resolves in the same tick, so the local player's blindness is already set.
        if (this.local.flashUntil > this.game.time + 1) {
          this.audio.ring(this.local.flashStrength);
          this.announcer.say('flashed', 10);
        }
        this.effects.explosion(e.pos, false);
        break;
      case 'smoke':
        this.audio.hiss(e.pos);
        break;
      case 'radio':
        this.hud.chat(`(RADIO) ${e.player.name}: ${e.text}`, e.player.team);
        if (e.player.team === this.local.team && e.player.isBot) {
          const cue = e.text.startsWith('Enemy spotted') ? 'spotted' : e.text.startsWith('Fall') || e.text.startsWith('Rotat') ? 'rotate' : e.text.startsWith('Go go') ? 'go' : e.text.startsWith('Fire in') ? 'fireinhole' : null;
          if (cue) this.announcer.say(cue, 4);
        }
        break;
      case 'respawn':
        if (e.player === this.local) {
          this.yaw = e.player.yaw;
          if (this.purchases.length) this.lastPurchases = this.purchases;
          this.purchases = [];
        }
        break;
      case 'round':
        if (e.phase === 'freeze') {
          this.audio.stopNukeWarning();
          if (this.purchases.length) this.lastPurchases = this.purchases;
          this.purchases = [];
          this.yaw = this.local.yaw;
          this.pitch = 0;
          this.specTarget = null;
          this.hud.message(`Round ${e.round}`, 2);
        } else if (e.phase === 'live') {
          this.announcer.say('go', 1);
        } else if (e.phase === 'matchover') {
          const d = this.defusal!;
          const w = d.score.T > d.score.CT ? 'Terrorists' : 'Counter-Terrorists';
          this.hud.message(`${w} win the match ${Math.max(d.score.T, d.score.CT)}-${Math.min(d.score.T, d.score.CT)}!`, 9, '#ffd24a');
          this.announcer.say(d.score.T > d.score.CT === (this.local.team === 'T') ? 'matchwin' : 'matchlose', 1);
        }
        break;
      case 'roundEnd': {
        const text = e.reason === 'bomb' ? 'Target Successfully Bombed!' : e.reason === 'defuse' ? 'Bomb Defused!' : e.winner === 'T' ? 'Terrorists Win!' : 'Counter-Terrorists Win!';
        this.hud.message(text, 4.5, e.winner === 'T' ? '#ff7a5a' : '#8ab8ff');
        this.announcer.say(e.reason === 'defuse' ? 'defused' : e.winner === 'T' ? 'terwin' : 'ctwin', 1);
        break;
      }
      case 'planted':
        this.hud.message('The bomb has been planted!', 3, '#ff7a5a');
        this.announcer.say('planted', 1);
        break;
      case 'explosion': {
        this.effects.explosion(e.pos, e.big);
        this.audio.explosion(e.pos, e.big);
        const d = this.renderer.camera.position.distanceTo(new THREE.Vector3(e.pos.x, e.pos.y, e.pos.z));
        this.shake = Math.max(this.shake, Math.max(0, 1 - d / 3000) * (e.big ? 1.2 : 0.6));
        break;
      }
      case 'nukeLaunch':
        this.announcer.say('strategic', 0);
        this.audio.nukeLaunch(Math.max(0, e.impactAt - this.game.time));
        break;
      case 'nukeImpact':
        this.audio.nukeImpact();
        break;
      case 'sound':
        if (e.name === 'bounce') {
          if (!this.audio.sampleFor('bounce', e.pos)) this.audio.click(e.pos, 900, 0.25);
        } else if (e.name === 'plant_start') {
          if (!this.audio.sampleFor('plant', e.pos)) this.audio.click(e.pos, 1500, 0.4);
        } else if (e.name === 'defuse' || e.name === 'defuse_kit') {
          if (!this.audio.sampleFor('defuse', e.pos)) this.audio.click(e.pos, 1500, 0.4);
        }
        else if (e.name === 'c4_beep') {
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
    let spectated: Player | null = null;
    this.input.wheelZoomOnly = !p.alive;
    this.nuke.update(this.game.nukes.strike, this.game.time);
    const nuclear = this.game.nukes.strike;
    if (nuclear?.exploded) this.renderer.setNuclearBlast(nuclear.pos, this.game.time - nuclear.impactAt);
    else this.renderer.setNuclearBlast(null);
    if (p.alive || this.game.time - this.deathTime < 2) {
      const vh = lerp(p.prevViewHeight, p.move.viewHeight);
      const bob = p.alive ? this.bob.update(dt, p.move.velocity.length2d()) : 0;
      const eyeY = p.alive ? vh + bob : Math.max(12, vh - (this.game.time - this.deathTime) * 100);
      this.renderer.setView(lerp(p.prevOrigin.x, p.origin.x), lerp(p.prevOrigin.y, p.origin.y) + eyeY, lerp(p.prevOrigin.z, p.origin.z), this.yaw + p.punchYaw + sx, this.pitch + p.punchPitch + sy);
      firstPerson = p.alive;
      this.hud.setSpectating(null);
    } else {
      firstPerson = false;
      spectated = this.drawSpectator(lerp, dt);
    }
    this.renderer.setZoom(firstPerson ? zoomFov : null);
    const cam = this.renderer.camera;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    this.audio.setListener(cam.position.x, cam.position.y, cam.position.z, fwd.x, fwd.y, fwd.z);

    for (const other of this.game.players) {
      let m = this.models.get(other);
      if (!m) {
        m = new PlayerModel();
        this.models.set(other, m);
        this.renderer.scene.add(m.root);
      }
      const hidden = (other === p && (p.alive || this.game.time - this.deathTime < 2)) || other === spectated;
      // Also hide anyone the camera is inside of (spectating a crowded spawn).
      const tooClose = !hidden && cam.position.distanceTo(new THREE.Vector3(other.origin.x, other.origin.y + 36, other.origin.z)) < 34;
      m.root.visible = !hidden && !tooClose;
      if (hidden || tooClose) continue;
      m.update(poseOf(other), lerp(other.prevOrigin.x, other.origin.x), lerp(other.prevOrigin.y, other.origin.y), lerp(other.prevOrigin.z, other.origin.z), dt, this.game.time);
      m.setLight(this.lightFor(other, dt));
    }
    this.syncDropped();
    this.syncBomb(dt);
    this.syncGrenades();
    this.smokes.update(this.game.grenades.smokes, this.game.time);

    const w = p.weapon;
    const scoped = firstPerson && !!zoomFov && !!w && (w.def.zoom?.length ?? 0) > 1;
    // In first-person spectating you see their gun, not yours.
    const vmOwner = spectated ?? p;
    const specScoped = !!spectated && !!spectated.weapon && spectated.weapon.zoom > 0 && (spectated.weapon.def.zoom?.length ?? 0) > 1;
    this.viewmodel.update(vmOwner, this.game.time, dt, spectated ? specScoped : scoped, !!vmOwner.weapon?.silenced, spectated ? 0 : this.bob.value);
    this.viewmodel.setLight(this.lightFor(vmOwner, dt));
    this.effects.update(dt);
    this.renderer.render(firstPerson || spectated ? this.viewmodel : undefined);

    // Crosshair gap in pixels from the current spread, like cl_dynamiccrosshair.
    let spreadPx = 0;
    if (w && w.def.clip > 0) {
      const spread = currentSpread(p, w);
      const vfov = this.renderer.camera.fov * DEG;
      spreadPx = Math.min(80, (spread / Math.tan(vfov / 2)) * (innerHeight / 2) * 0.6);
    }
    this.hud.update(p, spreadPx, scoped, dt);
    this.hud.setFlash(p, this.game.time);
    const targeting = p.alive && p.weapon?.def.id === 'silencer' && !this.game.nukes.strike;
    this.hud.setNukeTarget(targeting ? this.game.nukes.target(p).site : null, (p.weapon?.clip ?? 0) > 0);
    this.buyMenu.update();
    this.updateRoundHud();
    const d = this.defusal;
    const bomb = p.team === 'T' && d ? (d.bomb?.pos ?? d.looseC4) : null;
    // 30Hz is plenty for a radar and saves a large rotated canvas draw on the other frames.
    this.radarTime += dt;
    if (this.radarTime >= 1 / 30) {
      this.radarTime = 0;
      this.radar.draw(new Vec3(cam.position.x, 0, cam.position.z), firstPerson ? this.yaw : this.specYaw, p, this.game.players, bomb);
    }
    const title = `${this.options.map}  ·  ${this.defusal ? `Round ${this.defusal.round}` : 'Deathmatch'}`;
    const d2 = this.defusal;
    this.scoreboard.show(!this.tournament && (this.input.isDown('scores') || d2?.phase === 'matchover'), this.game.players, { score: d2?.score ?? null, history: d2?.history ?? [], half: d2?.cfg.halftime ?? 0, matchOver: d2?.phase === 'matchover' }, title, p);
    this.tournamentPanel.update(this.tournament, this.game.players, p, this.game.time, this.input.isDown('scores'), this.menu.visible);
  }

  /** Places the camera for whichever spectator mode is active; returns the player seen first-person, if any. */
  private drawSpectator(lerp: (a: number, b: number) => number, dt: number): Player | null {
    const wheel = this.input.takeWheel();
    this.specDist = Math.max(40, Math.min(700, this.specDist * Math.pow(1.15, wheel)));
    const labels = { free: 'Free Look', chase: 'Chase Cam', eyes: 'First Person', roam: 'Free Roam' };
    const help = 'Mouse1/2: player · Space: mode · Wheel: zoom';

    if (this.specMode === 'roam') {
      // Noclip camera: WASD relative to where you look, Shift slow, Ctrl down.
      const i = this.input;
      const f = new Vec3();
      const r = new Vec3();
      angleVectors(this.yaw, this.pitch, f, r);
      const speed = (i.isDown('walk') ? 250 : 900) * dt;
      this.roamPos.addScaled(f, ((i.isDown('forward') ? 1 : 0) - (i.isDown('back') ? 1 : 0)) * speed);
      this.roamPos.addScaled(r, ((i.isDown('right') ? 1 : 0) - (i.isDown('left') ? 1 : 0)) * speed);
      if (i.isDown('duck')) this.roamPos.y -= speed;
      this.renderer.setView(this.roamPos.x, this.roamPos.y, this.roamPos.z, this.yaw, this.pitch);
      this.specYaw = this.yaw;
      this.hud.setSpectating(`${labels.roam}  ·  WASD fly, Shift slow, Ctrl down  ·  Space: mode`);
      return null;
    }

    if (!this.specTarget || !this.specTarget.alive) this.nextSpecTarget();
    const t = this.specTarget;
    if (!t) {
      this.hud.setSpectating('Nobody left to spectate  ·  Space: mode');
      return null;
    }
    const eye = new Vec3(lerp(t.prevOrigin.x, t.origin.x), lerp(t.prevOrigin.y, t.origin.y) + lerp(t.prevViewHeight, t.move.viewHeight), lerp(t.prevOrigin.z, t.origin.z));
    this.hud.setSpectating(`${labels[this.specMode]}: ${t.name} (${t.health} HP)  ·  ${help}`);

    if (this.specMode === 'eyes') {
      this.specYaw = t.yaw;
      this.specPitch = t.pitch;
      this.renderer.setView(eye.x, eye.y, eye.z, t.yaw + t.punchYaw, t.pitch + t.punchPitch);
      return t;
    }
    if (this.specMode === 'chase') {
      // Follow their view, eased so bot flicks don't jerk the camera around.
      const ease = 1 - Math.exp(-dt * 8);
      this.specYaw += angleDiff(t.yaw, this.specYaw) * ease;
      this.specPitch += (t.pitch * 0.5 - 10 - this.specPitch) * ease;
    } else {
      // Free look: your mouse orbits the camera around them.
      this.specYaw = this.yaw;
      this.specPitch = this.pitch;
    }
    const f = new Vec3();
    angleVectors(this.specYaw, this.specPitch, f);
    // Pull in if a wall is in the way.
    const want = eye.clone().addScaled(f, -this.specDist);
    this.game.world.trace(eye, want, new Vec3(-4, -4, -4), new Vec3(4, 4, 4), this.tr);
    const cam = this.tr.endpos;
    this.renderer.setView(cam.x, cam.y, cam.z, this.specYaw, this.specPitch);
    return null;
  }

  private sunSmooth = new Map<Player, number>();

  /** Brightness for a player model: eased toward full sun or shade as they move, so there's no pop. */
  private lightFor(p: Player, dt: number): number {
    const chest = p.origin.clone();
    chest.y += 48;
    const target = 0.55 + 0.45 * this.renderer.sunAt(chest);
    const cur = this.sunSmooth.get(p) ?? target;
    const next = cur + (target - cur) * Math.min(1, dt * 6);
    this.sunSmooth.set(p, next);
    return next;
  }

  private updateRoundHud(): void {
    const d = this.defusal;
    const p = this.local;
    if (this.tournament) {
      this.hud.setRound(null, null);
      this.hud.setProgress(null, 0);
      this.hud.setIcons(false, 'none', false);
      return;
    }
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

  private syncGrenades(): void {
    const live = new Set<object>(this.game.grenades.live);
    for (const [n, mesh] of this.nadeMeshes) {
      if (!live.has(n)) {
        this.renderer.scene.remove(mesh);
        this.nadeMeshes.delete(n);
      }
    }
    for (const n of this.game.grenades.live) {
      let mesh = this.nadeMeshes.get(n);
      if (!mesh) {
        mesh = buildWeaponModel(n.id).group;
        mesh.scale.setScalar(0.8);
        this.nadeMeshes.set(n, mesh);
        this.renderer.scene.add(mesh);
      }
      mesh.position.set(n.pos.x, n.pos.y, n.pos.z);
      if (!n.stopped) mesh.rotation.x += 0.3;
    }
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
