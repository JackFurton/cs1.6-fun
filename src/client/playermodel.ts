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
  ankle: THREE.Group;
}

/** Upper arm and forearm, each a stretchy box hanging from its joint. */
interface Arm {
  upper: THREE.Mesh;
  fore: THREE.Mesh;
  hand: THREE.Mesh;
}

const UPPER_ARM = 11;
const FOREARM = 11;

export class PlayerModel {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private hips = new THREE.Group();
  private torso = new THREE.Group();
  private legs: Leg[] = [];
  private stomach!: THREE.Mesh;
  private chest!: THREE.Mesh;
  private head: THREE.Group = new THREE.Group();
  private armL!: Arm;
  private armR!: Arm;
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
      // Feet hang off an ankle joint so they can stay flat on the floor.
      const ankle = new THREE.Group();
      ankle.position.set(0, -SHIN, 0);
      knee.add(ankle);
      part(ankle, boots, lw * 0.9, FOOT, 11, 0, -FOOT / 2, -2);
      this.legs.push({ hip, knee, ankle });
    }
    this.hips.add(this.torso);
    this.stomach = part(this.torso, mat(s.shirt), 1, 1, 1, 0, 0, 0);
    this.chest = part(this.torso, mat(s.vest), 1, 1, 1, 0, 0, 0);
    this.head = buildHead(s);
    this.torso.add(this.head);
    const sleeve = mat(s.shirt);
    const vest = mat(s.vest);
    const glove = mat(s.gloves);
    const arm = (): Arm => ({
      upper: part(this.torso, sleeve, 4.6, 1, 4.6, 0, 0, 0, hangBox),
      fore: part(this.torso, sleeve, 4, 1, 4, 0, 0, 0, hangBox),
      hand: part(this.torso, glove, 3.6, 3.6, 3.6, 0, 0, 0),
    });
    this.armL = arm();
    this.armR = arm();
    // Shoulder pads so the arms join the torso instead of floating beside it.
    for (const side of [-1, 1]) part(this.torso, vest, 6, 5, 8, side * 9, 0, 0).name = side < 0 ? 'padL' : 'padR';
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
    // Cadence follows ground speed; with the wider stride below feet slide much less than before.
    if (p.onGround && p.speed > 5) this.phase += (p.speed / 250) * dt * 12.5;
    if (p.onGround && !this.wasOnGround) this.landTime = time;
    this.wasOnGround = p.onGround;
    const land = Math.max(0, 1 - (time - this.landTime) / 0.18);

    // Knee angle that puts the hips at the right height with the feet on the floor.
    const base = Math.acos(Math.min(1, Math.max(0, (hipY - FOOT) / (THIGH + SHIN))));
    const bob = Math.abs(Math.sin(this.phase)) * 1.6 * sf - land * 3;
    this.hips.position.set(0, hipY + bob, 0);
    this.legs.forEach((leg, i) => {
      const ph = this.phase + (i ? Math.PI : 0);
      const amp = (p.speed > 160 ? 0.78 : 0.5) * (duck > 0.5 ? 0.5 : 1);
      let thigh = base + Math.sin(ph) * amp * sf;
      // Lift the knee on the way forward, straight leg on the way back.
      let knee = -2 * base - Math.max(0, Math.cos(ph)) * 1.2 * sf;
      if (!p.onGround) {
        // Tucked in the air, one leg a little ahead of the other.
        thigh = base + 0.55 + (i ? 0.2 : 0);
        knee = -2 * base - 1.1;
      }
      leg.hip.rotation.x = thigh;
      leg.knee.rotation.x = knee;
      // Keep the sole roughly level with the ground.
      leg.ankle.rotation.x = -(thigh + knee) * 0.85;
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
    // A little shoulder twist with each stride.
    this.torso.rotation.y = Math.sin(this.phase) * 0.07 * sf;

    // Gun in front of the chest, pitched with the aim; hands reach for grip and handguard.
    const shoulderY = c1 - hipY - 2.5;
    const pitch = p.pitch * DEG;
    const kick = time - p.firedAt < 0.08 ? 1.5 : 0;
    const id = p.alive ? p.weapon : null;
    const long = !!id && !['glock', 'usp', 'p228', 'deagle', 'fiveseven', 'elite', 'knife', 'hegrenade', 'flashbang', 'smokegrenade', 'c4'].includes(id);
    // Rifles sit with the stock in the right shoulder; pistols are pushed out in both hands.
    if (long) this.gunHolder.position.set(4, shoulderY - 3, -10 + kick);
    else this.gunHolder.position.set(1.5, shoulderY - 2, -17 + kick);
    this.gunHolder.rotation.x = pitch;
    for (const c of this.torso.children) if (c.name === 'padL' || c.name === 'padR') c.position.y = shoulderY + 1;
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
    const grip = new THREE.Vector3(0, -1.5, 0.5).applyMatrix4(this.gunHolder.matrix);
    const fore = new THREE.Vector3(0, 0, long ? -9 : 0).applyMatrix4(this.gunHolder.matrix);
    if (!long) fore.x -= 2.5;
    // Elbows bend down and out, the way you'd hold a rifle.
    this.ik(this.armR, new THREE.Vector3(cw - 1, shoulderY, 0), grip, new THREE.Vector3(1, -1, 0.3));
    this.ik(this.armL, new THREE.Vector3(-(cw - 1), shoulderY, 0), fore, new THREE.Vector3(-1, -1.2, 0.2));

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

  /** Two-bone IK: place the elbow so upper arm and forearm reach from shoulder to hand, bending toward `pole`. */
  private ik(arm: Arm, shoulder: THREE.Vector3, hand: THREE.Vector3, pole: THREE.Vector3): void {
    const toHand = hand.clone().sub(shoulder);
    const d = Math.min(toHand.length(), UPPER_ARM + FOREARM - 0.01);
    const dir = toHand.normalize();
    // Law of cosines for how far along the shoulder-hand line the elbow sits, then how far off it.
    const a = (UPPER_ARM * UPPER_ARM - FOREARM * FOREARM + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, UPPER_ARM * UPPER_ARM - a * a));
    const bend = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
    const elbow = shoulder.clone().addScaledVector(dir, a).addScaledVector(bend, h);
    const reachHand = shoulder.clone().addScaledVector(dir, d);
    this.bone(arm.upper, shoulder, elbow);
    this.bone(arm.fore, elbow, reachHand);
    arm.hand.position.copy(reachHand);
  }

  private bone(m: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3): void {
    const v = to.clone().sub(from);
    const len = Math.max(1, v.length());
    m.position.copy(from);
    m.quaternion.setFromUnitVectors(DOWN, v.normalize());
    m.scale.y = len;
  }
}
