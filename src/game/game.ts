import { boxBrush, setBoxBrush, type Brush } from '../engine/brush';
import { PlayerMover } from '../engine/pmove';
import { CollisionWorld } from '../engine/trace';
import { Vec3, angleVectors } from '../engine/vec';
import type { MapData, Team } from '../maps/types';
import { Player } from './player';

export const TICK_RATE = 100;
export const TICK_DT = 1 / TICK_RATE;

export class Game {
  readonly world: CollisionWorld;
  readonly mover: PlayerMover;
  readonly players: Player[] = [];
  time = 0;
  private playerBoxes = new Map<Player, Brush>();

  constructor(readonly map: MapData) {
    this.world = new CollisionWorld(map.brushes);
    this.mover = new PlayerMover(this.world);
  }

  addPlayer(name: string, team: Team, isBot: boolean): Player {
    const p = new Player(this.players.length, name, team, isBot);
    this.players.push(p);
    this.playerBoxes.set(p, boxBrush(new Vec3(), new Vec3(), 'player'));
    return p;
  }

  spawn(p: Player, index: number): void {
    const spawns = this.map.spawns[p.team];
    const s = spawns[index % spawns.length];
    p.move.origin.copy(s.pos);
    p.move.origin.y += 1;
    p.move.velocity.set(0, 0, 0);
    p.move.ducked = false;
    p.move.duckAmount = 0;
    p.yaw = s.yaw;
    p.pitch = 0;
    p.alive = true;
    p.health = 100;
    this.mover.categorize(p.move);
    p.prevOrigin.copy(p.origin);
  }

  tick(): void {
    for (const p of this.players) {
      p.prevOrigin.copy(p.origin);
      p.prevViewHeight = p.move.viewHeight;
    }
    for (const p of this.players) {
      if (!p.alive) continue;
      p.yaw = p.cmd.yaw;
      p.pitch = p.cmd.pitch;
      if (p.noclip) {
        this.fly(p);
        continue;
      }
      this.mover.others = this.solidsExcept(p);
      this.mover.move(p.move, { ...p.cmd }, 250, TICK_DT);
    }
    this.time += TICK_DT;
  }

  private fly(p: Player): void {
    const f = new Vec3();
    const r = new Vec3();
    angleVectors(p.yaw, p.pitch, f, r);
    const speed = p.cmd.walk ? 200 : 800;
    p.move.velocity.set(0, 0, 0).addScaled(f, p.cmd.forward * speed).addScaled(r, p.cmd.side * speed);
    p.move.origin.addScaled(p.move.velocity, TICK_DT);
  }

  private solidsExcept(self: Player): Brush[] {
    const out: Brush[] = [];
    for (const p of this.players) {
      if (p === self || !p.alive) continue;
      const b = this.playerBoxes.get(p)!;
      setBoxBrush(b, p.origin.clone().add(p.move.mins), p.origin.clone().add(p.move.maxs));
      out.push(b);
    }
    return out;
  }
}
