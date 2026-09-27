import { MoveState } from '../engine/pmove';
import { Vec3 } from '../engine/vec';
import type { Team } from '../maps/types';
import { emptyCmd, type UserCmd } from './usercmd';
import { WEAPONS, type Slot, type WeaponDef, type WeaponId } from './weapons';

export class WeaponState {
  clip: number;
  reserve: number;
  shotsFired = 0;
  /** Pistol accuracy (time model); higher is better. */
  accuracy: number;
  lastFire = -10;
  decreaseShotsAt = 0;
  /** Trigger has been held since the last shot; semi-autos need a release. */
  delayFire = false;
  kickDir = 1;
  silenced = false;
  burst = false;
  burstLeft = 0;
  zoom = 0;
  /** Scope level to restore after the bolt cycles on a sniper. */
  resumeZoom = 0;
  reloadEnd = 0;
  reloading = false;

  constructor(readonly def: WeaponDef) {
    this.clip = def.clip;
    this.reserve = def.reserve;
    this.accuracy = def.accuracy.kind === 'time' ? def.accuracy.max : 0;
  }
}

export class Player {
  readonly move = new MoveState();
  /** Origin at the previous tick, for render interpolation. */
  readonly prevOrigin = new Vec3();
  prevViewHeight = 64;
  yaw = 0;
  pitch = 0;
  /** View punch from recoil, degrees; positive pitch is up. */
  punchPitch = 0;
  punchYaw = 0;
  cmd: UserCmd = emptyCmd();
  alive = true;
  health = 100;
  armor = 0;
  helmet = false;
  defuser = false;
  money = 800;
  kills = 0;
  deaths = 0;
  /** 1.6 "tagging": getting shot drops this to 0.5 and it recovers 0.01 per tick while slowing you. */
  velocityModifier = 1;
  noclip = false;

  weapons: Partial<Record<Slot, WeaponState>> = {};
  grenades: Partial<Record<WeaponId, number>> = {};
  active: Slot = 'knife';
  lastSlot: Slot = 'knife';
  nextAttack = 0;
  attack2Held = false;
  /** Time the current weapon finished deploying; for draw animations. */
  deployedAt = 0;

  /** Last time this player made noise others could hear, and where. */
  lastNoise = { time: -10, radius: 0 };
  lastDamageTime = -10;
  lastAttacker: Player | null = null;
  flashUntil = 0;
  flashStrength = 0;

  constructor(
    readonly id: number,
    public name: string,
    public team: Team,
    readonly isBot: boolean,
  ) {}

  get origin(): Vec3 {
    return this.move.origin;
  }

  get weapon(): WeaponState | undefined {
    return this.weapons[this.active];
  }

  eye(out = new Vec3()): Vec3 {
    return out.set(this.origin.x, this.origin.y + this.move.viewHeight, this.origin.z);
  }

  maxSpeed(): number {
    const w = this.weapon;
    if (!w) return 250;
    if (w.zoom > 0 && w.def.scopedSpeed) return w.def.scopedSpeed;
    return w.def.speed;
  }

  give(id: WeaponId): WeaponState {
    const def = WEAPONS[id];
    const w = new WeaponState(def);
    this.weapons[def.slot] = w;
    return w;
  }

  resetLoadout(): void {
    this.weapons = {};
    this.grenades = {};
    this.give('knife');
    this.give(this.team === 'T' ? 'glock' : 'usp');
    this.active = 'secondary';
    this.lastSlot = 'knife';
  }
}
