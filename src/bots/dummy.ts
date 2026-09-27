import type { Player } from '../game/player';

/** Target-practice bot: strafes back and forth and sometimes crouches. Replaced by real AI later. */
export function dummyThink(p: Player, time: number): void {
  const phase = Math.sin(time * 1.3 + p.id * 1.7);
  p.cmd.side = phase > 0.2 ? 1 : phase < -0.2 ? -1 : 0;
  p.cmd.forward = 0;
  p.cmd.duck = Math.sin(time * 0.4 + p.id) > 0.85;
  p.cmd.walk = false;
  p.cmd.jump = false;
  p.cmd.attack = false;
}
