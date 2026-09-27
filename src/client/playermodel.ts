import * as THREE from 'three';
import { DEG } from '../engine/vec';
import { BODY_HALF, bodyRange } from '../game/hitbox';
import type { Player } from '../game/player';
import type { WeaponId } from '../game/weapons';
import type { Team } from '../maps/types';
import { skinFor, type Skin } from './skins';
import { buildWeaponModel } from './weaponmodel';

const box = new THREE.BoxGeometry(1, 1, 1);
// Pivot at the top so limbs rotate from hip, knee and shoulder.
const hangBox = new THREE.BoxGeometry(1, 1, 1).translate(0, -0.5, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

const THIGH = 17;
const SHIN = 15;
const FOOT = 2;

/** Everything the model needs to pose itself; previews build one without a real Player. */
export interface PoseInput {
  team: Team;
  model: number;
  yaw: number;
  pitch: number;
  alive: boolean;
  speed: number;
  onGround: boolean;
  duck: number;
  weapon: WeaponId | null;
  firedAt: number;
}

export function poseOf(p: Player): PoseInput {
  return {
    team: p.team,
    model: p.model,
    yaw: p.yaw,
    pitch: p.pitch,
    alive: p.alive,
    speed: p.move.velocity.length2d(),
    onGround: p.move.onGround,
    duck: p.move.ducked ? 1 : p.move.duckAmount,
    weapon: p.weapon?.def.id ?? null,
    firedAt: p.weapon?.lastFire ?? -10,
  };
}

function mat(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color });
}

function part(parent: THREE.Object3D, m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, geo = box): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, m);
  mesh.scale.set(w, h, d);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

/** Head centred on the origin, face toward -z, with the skin's headgear. */
function buildHead(s: Skin): THREE.Group {
  const g = new THREE.Group();
  const skin = mat(s.skin);
  const hat = mat(s.hat);
  const dark = mat(0x1a1a1a);
  const covered = s.head === 'balaclava' || s.head === 'gasmask';
  part(g, covered ? hat : skin, 11, 12, 12, 0, 0, 0);
  switch (s.head) {
    case 'balaclava':
      part(g, skin, 8.5, 2.2, 0.6, 0, 1.5, -6.1);
      break;
    case 'bandana':
      part(g, hat, 11.6, 3, 12.6, 0, 4.8, 0);
      break;
    case 'cap':
      part(g, hat, 12, 3.5, 12.6, 0, 5, 0);
      part(g, hat, 10, 1, 5, 0, 3.6, -8.2);
      break;
    case 'beret':
      part(g, hat, 12.5, 2.5, 12.5, 1, 6.5, 0).rotation.z = 0.2;
      break;
    case 'helmet':
      part(g, hat, 13, 6.5, 13.5, 0, 4.2, 0.4);
      break;
    case 'gasmask':
      part(g, dark, 9, 7, 1.5, 0, -1, -6.5);
      part(g, mat(0x6a7a80), 3, 2.2, 0.6, -2.4, 1.5, -7.4);
      part(g, mat(0x6a7a80), 3, 2.2, 0.6, 2.4, 1.5, -7.4);
      part(g, mat(0x333333), 3, 3, 3.5, 0, -4, -8);
      break;
  }
  if (s.sunglasses) part(g, dark, 9, 2, 0.8, 0, 1.2, -6.2);
  if (s.goggles) part(g, mat(0x2a2a2a), 10, 2.6, 1.2, 0, 1.6, -6.4);
  return g;
}

interface Leg {
  hip: THREE.Group;
  knee: THREE.Group;
}

export class PlayerModel {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private hips = new THREE.Group();
  private torso = new THREE.Group();
  private legs: Leg[] = [];
  private stomach!: THREE.Mesh;
  private chest!: THREE.Mesh;
  private head: THREE.Group = new THREE.Group();
  private armL!: THREE.Mesh;
  private armR!: THREE.Mesh;
  private gunHolder = new THREE.Group();
  private gunId: WeaponId | null = null;
  private skinKey = '';
  private phase = 0;
  private deathTime = -1;
  private deathDir = 1;
  private wasOnGround = true;
  private landTime = -10;

  constructor() {
    this.root.add(this.body);
    this.body.add(this.hips);
  }

  private build(s: Skin): void {
    this.hips.clear();
    this.torso = new THREE.Group();
    this.legs = [];
    const pants = mat(s.pants);
    const boots = mat(0x1e1c18);
    const [lw] = BODY_HALF.legs;
    for (const side of [-1, 1]) {
      // Joints are plain groups so the scaled limb meshes don't pass their scale down the chain.
      const hip = new THREE.Group();
      hip.position.set(side * lw * 0.5, 0, 0);
      this.hips.add(hip);
      part(hip, pants, lw * 0.85, THIGH, 8, 0, 0, 0, hangBox);
      const knee = new THREE.Group();
      knee.position.set(0, -THIGH, 0);
      hip.add(knee);
      part(knee, pants, lw * 0.8, SHIN, 7.5, 0, 0, 0, hangBox);
      part(knee, boots, lw * 0.85, FOOT, 11, 0, -SHIN - FOOT / 2, -2);
      this.legs.push({ hip, knee });
    }
    this.hips.add(this.torso);
    this.stomach = part(this.torso, mat(s.shirt), 1, 1, 1, 0, 0, 0);
    this.chest = part(this.torso, mat(s.vest), 1, 1, 1, 0, 0, 0);
    this.head = buildHead(s);
    this.torso.add(this.head);
    const sleeve = mat(s.shirt);
    this.armL = part(this.torso, sleeve, 3.8, 1, 3.8, 0, 0, 0, hangBox);
    this.armR = part(this.torso, sleeve, 3.8, 1, 3.8, 0, 0, 0, hangBox);
    // Gloves/hands at the end of each arm.
    for (const arm of [this.armL, this.armR]) {
      const hand = new THREE.Mesh(box, mat(s.gloves));
      hand.scale.set(1.1, 0.12, 1.1);
      hand.position.set(0, -1, 0);
      arm.add(hand);
    }
    this.torso.add(this.gunHolder);
    this.gunId = null;
    this.root.traverse((o) => (o.castShadow = true));
  }

  update(p: PoseInput, x: number, y: number, z: number, dt: number, time: number): void {
    const key = `${p.team}:${p.model}`;
    if (key !== this.skinKey) {
      this.skinKey = key;
      this.build(skinFor(p.team, p.model));
    }
    this.root.position.set(x, y, z);
    this.root.rotation.y = p.yaw * DEG;
    const duck = p.duck;

    const [, hipY] = bodyRange('legs', duck);
    const [s0, s1] = bodyRange('stomach', duck);
    const [c0, c1] = bodyRange('chest', duck);
    const [h0, h1] = bodyRange('head', duck);

    // Gait: phase advances with ground speed; walking (shift) swings less than running.
    const sf = p.onGround ? Math.min(1, p.speed / 230) : 0;
    if (p.onGround && p.speed > 5) this.phase += (p.speed / 250) * dt * 10;
    if (p.onGround && !this.wasOnGround) this.landTime = time;
    this.wasOnGround = p.onGround;
    const land = Math.max(0, 1 - (time - this.landTime) / 0.18);

    // Knee angle that puts the hips at the right height with the feet on the floor.
    const base = Math.acos(Math.min(1, Math.max(0, (hipY - FOOT) / (THIGH + SHIN))));
    const bob = Math.abs(Math.sin(this.phase)) * 1.6 * sf - land * 3;
    this.hips.position.set(0, hipY + bob, 0);
    this.legs.forEach((leg, i) => {
      const ph = this.phase + (i ? Math.PI : 0);
      let thigh = base + Math.sin(ph) * 0.65 * sf * (duck > 0.5 ? 0.5 : 1);
      let knee = -2 * base - Math.max(0, -Math.cos(ph)) * 1.1 * sf;
      if (!p.onGround) {
        // Tucked in the air, one leg a little ahead of the other.
        thigh = base + 0.55 + (i ? 0.2 : 0);
        knee = -2 * base - 1.1;
      }
      leg.hip.rotation.x = thigh;
      leg.knee.rotation.x = knee;
    });

    // Torso sits on the hips; parts are placed relative to hip height.
    const [sw, sd] = BODY_HALF.stomach;
    const [cw, cd] = BODY_HALF.chest;
    const [hw] = BODY_HALF.head;
    this.stomach.position.set(0, (s0 + s1) / 2 - hipY, 0);
    this.stomach.scale.set(sw * 2, s1 - s0, sd * 2);
    this.chest.position.set(0, (c0 + c1) / 2 - hipY, 0);
    this.chest.scale.set(cw * 2 - 3, c1 - c0, cd * 2);
    this.head.position.set(0, (h0 + h1) / 2 - hipY, -1);
    this.head.scale.setScalar(Math.min(1, (hw * 2) / 11));
    this.torso.rotation.x = -0.12 * sf - p.pitch * DEG * 0.15;

    // Gun in front of the chest, pitched with the aim; hands reach for grip and handguard.
    const shoulderY = c1 - hipY - 2.5;
    const pitch = p.pitch * DEG;
    const kick = time - p.firedAt < 0.08 ? 1.5 : 0;
    this.gunHolder.position.set(1, shoulderY - 5, -13 + kick);
    this.gunHolder.rotation.x = pitch;
    const id = p.alive ? p.weapon : null;
    if (id !== this.gunId) {
      this.gunHolder.clear();
      if (id) {
        const m = buildWeaponModel(id);
        m.group.traverse((o) => (o.castShadow = true));
        this.gunHolder.add(m.group);
      }
      this.gunId = id;
    }
    this.gunHolder.updateMatrix();
    const long = !!id && !['glock', 'usp', 'p228', 'deagle', 'fiveseven', 'elite', 'knife', 'hegrenade', 'flashbang', 'smokegrenade', 'c4'].includes(id);
    const grip = new THREE.Vector3(0, -1, 0.5).applyMatrix4(this.gunHolder.matrix);
    const fore = new THREE.Vector3(0, 0, long ? -9 : -0.5).applyMatrix4(this.gunHolder.matrix);
    this.reach(this.armR, new THREE.Vector3(cw - 2, shoulderY, 0), grip);
    this.reach(this.armL, new THREE.Vector3(-(cw - 2), shoulderY, 0), long ? fore : grip.clone().add(new THREE.Vector3(-1.5, 0, 0)));

    if (!p.alive) {
      if (this.deathTime < 0) {
        this.deathTime = time;
        this.deathDir = Math.random() < 0.5 ? 1 : -1;
      }
      const t = Math.min(1, (time - this.deathTime) / 0.4);
      this.body.rotation.x = this.deathDir * ((t * t * Math.PI) / 2);
      this.body.position.y = t * 3;
    } else {
      this.deathTime = -1;
      this.body.rotation.x = 0;
      this.body.position.y = 0;
    }
  }

  /** Point an arm from its shoulder to a hand position, stretching it to fit. */
  private reach(arm: THREE.Mesh, shoulder: THREE.Vector3, hand: THREE.Vector3): void {
    const dir = hand.clone().sub(shoulder);
    const len = Math.max(4, dir.length());
    arm.position.copy(shoulder);
    arm.quaternion.setFromUnitVectors(DOWN, dir.normalize());
    arm.scale.set(3.8, len, 3.8);
  }
}
