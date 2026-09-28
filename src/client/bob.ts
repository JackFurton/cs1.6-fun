/**
 * Half-Life's V_CalcBob with CS 1.6's defaults (cl_bob 0.01, cl_bobcycle 0.8, cl_bobup 0.5).
 * The same value moves the camera up and the gun a little forward, so the whole view bobs,
 * not just the weapon.
 */
export class ViewBob {
  private bobtime = 0;
  value = 0;

  update(dt: number, speed2d: number): number {
    const bob = 0.01;
    const cycleLen = 0.8;
    const up = 0.5;
    this.bobtime += dt;
    let cycle = (this.bobtime % cycleLen) / cycleLen;
    cycle = cycle < up ? (Math.PI * cycle) / up : Math.PI + (Math.PI * (cycle - up)) / (1 - up);
    let b = speed2d * bob;
    b = b * 0.3 + b * 0.7 * Math.sin(cycle);
    this.value = Math.max(-7, Math.min(4, b));
    return this.value;
  }
}
