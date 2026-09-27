import { MoveState } from '../engine/pmove';
import { Vec3 } from '../engine/vec';
import type { Team } from '../maps/types';
import { emptyCmd, type UserCmd } from './usercmd';

export class Player {
  readonly move = new MoveState();
  /** Origin at the previous tick, for render interpolation. */
  readonly prevOrigin = new Vec3();
  prevViewHeight = 64;
  yaw = 0;
  pitch = 0;
  cmd: UserCmd = emptyCmd();
  alive = true;
  health = 100;
  /** Free-fly through walls (debug and spectating). */
  noclip = false;

  constructor(
    readonly id: number,
    public name: string,
    public team: Team,
    readonly isBot: boolean,
  ) {}

  get origin(): Vec3 {
    return this.move.origin;
  }

  eye(out = new Vec3()): Vec3 {
    return out.set(this.origin.x, this.origin.y + this.move.viewHeight, this.origin.z);
  }
}
