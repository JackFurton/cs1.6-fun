// World is Y-up, in GoldSrc units (1 unit ~ 1 inch).
export class Vec3 {
  constructor(
    public x = 0,
    public y = 0,
    public z = 0,
  ) {}

  set(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }
  copy(v: Vec3): this {
    return this.set(v.x, v.y, v.z);
  }
  clone(): Vec3 {
    return new Vec3(this.x, this.y, this.z);
  }
  add(v: Vec3): this {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }
  sub(v: Vec3): this {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }
  scale(s: number): this {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }
  addScaled(v: Vec3, s: number): this {
    this.x += v.x * s;
    this.y += v.y * s;
    this.z += v.z * s;
    return this;
  }
  dot(v: Vec3): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }
  length(): number {
    return Math.hypot(this.x, this.y, this.z);
  }
  length2d(): number {
    return Math.hypot(this.x, this.z);
  }
  normalize(): number {
    const len = this.length();
    if (len > 0) this.scale(1 / len);
    return len;
  }
  distanceTo(v: Vec3): number {
    return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z);
  }
  lerpVectors(a: Vec3, b: Vec3, t: number): this {
    return this.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
  }
}

export function cross(a: Vec3, b: Vec3, out = new Vec3()): Vec3 {
  return out.set(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}

export const DEG = Math.PI / 180;

/** Yaw 0 looks down -Z, positive yaw turns left; pitch positive looks up (degrees). */
export function angleVectors(yawDeg: number, pitchDeg: number, forward?: Vec3, right?: Vec3, up?: Vec3): void {
  const y = yawDeg * DEG;
  const p = pitchDeg * DEG;
  const sy = Math.sin(y);
  const cy = Math.cos(y);
  const sp = Math.sin(p);
  const cp = Math.cos(p);
  forward?.set(-sy * cp, sp, -cy * cp);
  right?.set(cy, 0, -sy);
  up?.set(-sy * -sp, cp, -cy * -sp);
}

export function yawTo(from: Vec3, to: Vec3): number {
  return Math.atan2(-(to.x - from.x), -(to.z - from.z)) / DEG;
}

export function pitchTo(from: Vec3, to: Vec3): number {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  return Math.atan2(to.y - from.y, Math.hypot(dx, dz)) / DEG;
}

export function angleDiff(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}
