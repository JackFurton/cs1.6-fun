import * as THREE from 'three';
import { DEG } from '../engine/vec';
import { BODY_HALF, bodyRange } from '../game/hitbox';
import type { Player } from '../game/player';
import type { WeaponId } from '../game/weapons';
import { buildWeaponModel } from './weaponmodel';

const box = new THREE.BoxGeometry(1, 1, 1);
// Pivot at the top so legs and arms swing from hip and shoulder.
const hangBox = new THREE.BoxGeometry(1, 1, 1).translate(0, -0.5, 0);

interface Palette {
  pants: number;
  shirt: number;
  vest: number;
  head: number;
  hat: number;
  skin: number;
}

const PALETTES: Record<'T' | 'CT', Palette> = {
  T: { pants: 0x5a4e3a, shirt: 0x7a6a4a, vest: 0x4a4436, head: 0x2a2a28, hat: 0x2a2a28, skin: 0xc09070 },
  CT: { pants: 0x2a3444, shirt: 0x34405a, vest: 0x1e2430, head: 0xc09070, hat: 0x22262c, skin: 0xc09070 },
};

function lambert(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color });
}

export class PlayerModel {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private legL: THREE.Mesh;
  private legR: THREE.Mesh;
  private stomach: THREE.Mesh;
  private chest: THREE.Mesh;
  private head: THREE.Mesh;
  private hat: THREE.Mesh;
  private armL: THREE.Mesh;
  private armR: THREE.Mesh;
  private gunHolder = new THREE.Group();
  private gunId: WeaponId | null = null;
  private walkPhase = 0;
  private deathTime = -1;
  private team: 'T' | 'CT';

  constructor(team: 'T' | 'CT') {
    this.team = team;
    const p = PALETTES[team];
    this.legL = new THREE.Mesh(hangBox, lambert(p.pants));
    this.legR = new THREE.Mesh(hangBox, lambert(p.pants));
    this.stomach = new THREE.Mesh(box, lambert(p.shirt));
    this.chest = new THREE.Mesh(box, lambert(p.vest));
    this.head = new THREE.Mesh(box, lambert(p.head));
    this.hat = new THREE.Mesh(box, lambert(p.hat));
    this.armL = new THREE.Mesh(hangBox, lambert(p.shirt));
    this.armR = new THREE.Mesh(hangBox, lambert(p.shirt));
    this.body.add(this.legL, this.legR, this.stomach, this.chest, this.head, this.hat, this.armL, this.armR, this.gunHolder);
    this.root.add(this.body);
    this.root.traverse((o) => {
      o.castShadow = true;
    });
  }

  setTeam(team: 'T' | 'CT'): void {
    if (team === this.team) return;
    this.team = team;
    const p = PALETTES[team];
    (this.legL.material as THREE.MeshLambertMaterial).color.set(p.pants);
    (this.legR.material as THREE.MeshLambertMaterial).color.set(p.pants);
    (this.stomach.material as THREE.MeshLambertMaterial).color.set(p.shirt);
    (this.chest.material as THREE.MeshLambertMaterial).color.set(p.vest);
    (this.head.material as THREE.MeshLambertMaterial).color.set(p.head);
    (this.hat.material as THREE.MeshLambertMaterial).color.set(p.hat);
    (this.armL.material as THREE.MeshLambertMaterial).color.set(p.shirt);
    (this.armR.material as THREE.MeshLambertMaterial).color.set(p.shirt);
  }

  update(p: Player, x: number, y: number, z: number, dt: number, time: number): void {
    this.setTeam(p.team);
    this.root.position.set(x, y, z);
    this.root.rotation.y = p.yaw * DEG;
    const duck = p.move.ducked ? 1 : p.move.duckAmount;

    const [l0, l1] = bodyRange('legs', duck);
    const [s0, s1] = bodyRange('stomach', duck);
    const [c0, c1] = bodyRange('chest', duck);
    const [h0, h1] = bodyRange('head', duck);
    const [lw, ld] = BODY_HALF.legs;
    const legLen = l1 - l0;

    const speed = p.move.velocity.length2d();
    if (p.move.onGround && speed > 5) this.walkPhase += (speed / 250) * dt * 9;
    else this.walkPhase *= 0.9;
    const swing = p.move.onGround ? Math.sin(this.walkPhase) * Math.min(1, speed / 200) * 0.6 : 0.25;

    for (const [leg, side, s] of [
      [this.legL, -1, swing],
      [this.legR, 1, -swing],
    ] as const) {
      leg.position.set(side * lw * 0.5, l1, 0);
      leg.scale.set(lw * 0.9, duck > 0.5 ? legLen + 6 : legLen, ld * 1.5);
      leg.rotation.x = duck > 0.5 ? -0.9 : s;
    }
    const [sw, sd] = BODY_HALF.stomach;
    this.stomach.position.set(0, (s0 + s1) / 2, 0);
    this.stomach.scale.set(sw * 2, s1 - s0, sd * 2);
    const [cw, cd] = BODY_HALF.chest;
    this.chest.position.set(0, (c0 + c1) / 2, 0);
    this.chest.scale.set(cw * 2 - 4, c1 - c0, cd * 2);
    const [hw, hd] = BODY_HALF.head;
    this.head.position.set(0, (h0 + h1) / 2, -1);
    this.head.scale.set(hw * 2, h1 - h0, hd * 2);
    this.hat.position.set(0, h1 - 1.5, -1);
    this.hat.scale.set(hw * 2 + 1, 3.5, hd * 2 + 1);

    // Arms reach forward to hold the gun, tilted with view pitch.
    const shoulderY = c1 - 2;
    const aim = -p.pitch * DEG;
    for (const [arm, side] of [
      [this.armL, -1],
      [this.armR, 1],
    ] as const) {
      arm.position.set(side * (cw - 2), shoulderY, 0);
      arm.scale.set(3.5, 16, 3.5);
      arm.rotation.set(Math.PI / 2 - 0.35 - aim, 0, side * 0.25);
    }
    this.gunHolder.position.set(0.5, shoulderY - 4, -12);
    this.gunHolder.rotation.x = -aim;

    const id = p.weapon?.def.id ?? null;
    if (id !== this.gunId) {
      this.gunHolder.clear();
      if (id && p.alive) {
        const m = buildWeaponModel(id);
        m.group.traverse((o) => (o.castShadow = true));
        this.gunHolder.add(m.group);
      }
      this.gunId = id;
    }

    if (!p.alive) {
      if (this.deathTime < 0) this.deathTime = time;
      const t = Math.min(1, (time - this.deathTime) / 0.35);
      this.body.rotation.x = (t * t * Math.PI) / 2;
      this.body.position.y = t * 4;
      this.gunHolder.visible = false;
    } else {
      this.deathTime = -1;
      this.body.rotation.x = 0;
      this.body.position.y = 0;
      this.gunHolder.visible = true;
    }
  }
}
