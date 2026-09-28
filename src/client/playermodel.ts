import * as THREE from 'three';
import { DEG } from '../engine/vec';
import { BODY_HALF, bodyRange } from '../game/hitbox';
import type { Player } from '../game/player';
import type { WeaponId } from '../game/weapons';
import type { Team } from '../maps/types';
import { skinFor, type Skin } from './skins';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { buildWeaponModel } from './weaponmodel';

// Shared geometry, all unit-sized and scaled per part. Rounded and tapered so bodies read as
// people rather than stacked blocks.
const rbox = new RoundedBoxGeometry(1, 1, 1, 3, 0.22);
const sphere = new THREE.SphereGeometry(0.5, 14, 10);
const dome = new THREE.SphereGeometry(0.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
// Limbs hang from their top so they rotate at hip, knee, shoulder and elbow; slightly tapered.
const limb = new THREE.CylinderGeometry(0.5, 0.42, 1, 12, 1).translate(0, -0.5, 0);
const disc = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);
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

let blobMat: THREE.MeshBasicMaterial | null = null;
function blobMaterial(): THREE.MeshBasicMaterial {
  if (blobMat) return blobMat;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,0.45)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  blobMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  return blobMat;
}

function mat(color: number, map?: THREE.Texture): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color: map ? 0xffffff : color, map: map ?? null });
}

function part(parent: THREE.Object3D, m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, geo: THREE.BufferGeometry = rbox): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, m);
  mesh.scale.set(w, h, d);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

const camoCache = new Map<number, THREE.Texture>();

/** Blotchy camo in shades of the base colour, so uniforms aren't flat plastic. */
function camo(base: number): THREE.Texture {
  const hit = camoCache.get(base);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const col = new THREE.Color(base);
  ctx.fillStyle = `#${col.getHexString()}`;
  ctx.fillRect(0, 0, 64, 64);
  let seed = base;
  const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
  for (const k of [0.78, 1.18, 0.9]) {
    ctx.fillStyle = `#${col.clone().multiplyScalar(k).getHexString()}`;
    for (let i = 0; i < 7; i++) {
      const x = rnd() * 64;
      const y = rnd() * 64;
      const rx = 4 + rnd() * 8;
      const ry = 3 + rnd() * 5;
      const rot = rnd() * Math.PI;
      // Wrapped copies so the pattern tiles.
      for (const [ox, oy] of [
        [0, 0],
        [-64, 0],
        [0, -64],
        [-64, -64],
      ]) {
        ctx.beginPath();
        ctx.ellipse(x + ox, y + oy, rx, ry, rot, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  const img = ctx.getImageData(0, 0, 64, 64);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = 0.92 + rnd() * 0.16;
    img.data[i] *= n;
    img.data[i + 1] *= n;
    img.data[i + 2] *= n;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(2, 2);
  camoCache.set(base, tex);
  return tex;
}

/** Head with a face, centred on the origin, looking down -z, wearing the skin's headgear. */
function buildHead(s: Skin): THREE.Group {
  const g = new THREE.Group();
  const skin = mat(s.skin);
  const hat = mat(s.hat);
  const dark = mat(0x151515);
  const covered = s.head === 'balaclava' || s.head === 'gasmask';
  // Skull a touch narrower than it is deep, jaw slightly forward.
  part(g, covered ? hat : skin, 8.6, 10.4, 9.6, 0, 0, 0);
  part(g, covered ? hat : skin, 7.2, 3.6, 7.4, 0, -4, -1);
  if (!covered) {
    part(g, skin, 1.4, 2.4, 1.6, 0, -0.4, -5); // nose
    part(g, dark, 1.3, 0.9, 0.4, -1.9, 1.2, -4.75, sphere); // eyes
    part(g, dark, 1.3, 0.9, 0.4, 1.9, 1.2, -4.75, sphere);
    part(g, mat(0x8a5a48), 3, 0.5, 0.4, 0, -3.3, -4.6); // mouth
    part(g, skin, 1, 2.6, 1.8, -4.4, 0.4, 0, sphere); // ears
    part(g, skin, 1, 2.6, 1.8, 4.4, 0.4, 0, sphere);
  }
  switch (s.head) {
    case 'balaclava':
      part(g, skin, 6.6, 2.2, 0.8, 0, 1.2, -4.6); // eye slit
      part(g, dark, 1.2, 0.8, 0.4, -1.8, 1.2, -5.05, sphere);
      part(g, dark, 1.2, 0.8, 0.4, 1.8, 1.2, -5.05, sphere);
      break;
    case 'bandana':
      part(g, hat, 9.4, 3.2, 10.2, 0, 3.6, 0.2);
      part(g, hat, 2, 2.5, 3, 0, 2.6, 5.4); // knot at the back
      break;
    case 'cap':
      part(g, hat, 9.8, 4.2, 10.4, 0, 4.2, 0.2, dome);
      part(g, hat, 8, 0.8, 5, 0, 4.4, -6.2);
      break;
    case 'beret':
      part(g, hat, 11, 3.2, 11, 1.2, 5.6, 0.4, sphere).rotation.z = 0.25;
      break;
    case 'helmet':
      part(g, hat, 11.6, 7.5, 12, 0, 2.2, 0.3, dome);
      part(g, hat, 11.8, 1.2, 12.2, 0, 2.2, 0.3, disc); // rim
      part(g, dark, 0.5, 5.5, 0.6, -4.6, -1.4, -0.2); // chin straps
      part(g, dark, 0.5, 5.5, 0.6, 4.6, -1.4, -0.2);
      break;
    case 'gasmask': {
      part(g, mat(0x2a2a2a), 7.4, 6, 3, 0, -1.2, -4.6);
      const lens = mat(0x6a8490);
      for (const x of [-2.1, 2.1]) part(g, lens, 2.8, 0.8, 2.8, x, 1.4, -5.8, disc).rotation.x = Math.PI / 2;
      part(g, mat(0x3a3a3a), 3, 3.4, 3, 0, -3.6, -7, disc).rotation.x = Math.PI / 2;
      part(g, dark, 9.2, 1, 10, 0, 1, 0.5); // head strap
      break;
    }
  }
  if (s.sunglasses) part(g, dark, 7.6, 1.8, 0.8, 0, 1.2, -4.9);
  if (s.goggles) {
    part(g, dark, 9.4, 1, 9.8, 0, 5.2, 0.4); // strap round the helmet
    const glass = mat(0x3c4c56);
    for (const x of [-2, 2]) part(g, glass, 3.2, 2.2, 1.2, x, 5.4, -5);
  }
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
  private belt!: THREE.Mesh;
  private pouches = new THREE.Group();
  private neck!: THREE.Mesh;
  private elbows: THREE.Mesh[] = [];
  private head: THREE.Group = new THREE.Group();
  private armL!: Arm;
  private armR!: Arm;
  private gunHolder = new THREE.Group();
  private gunId: WeaponId | null = null;
  private skinKey = '';
  private mats: THREE.MeshLambertMaterial[] = [];
  private light = -1;
  /** Soft dark disc under the feet, since nothing casts realtime shadows any more. */
  private blob = new THREE.Mesh(new THREE.CircleGeometry(20, 20), blobMaterial());
  private phase = 0;
  private deathTime = -1;
  private deathDir = 1;
  private wasOnGround = true;
  private landTime = -10;

  constructor() {
    this.root.add(this.body);
    this.body.add(this.hips);
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.position.y = 0.6;
    this.root.add(this.blob);
  }

  private build(s: Skin): void {
    this.hips.clear();
    this.torso = new THREE.Group();
    this.legs = [];
    const pants = mat(s.pants, camo(s.pants));
    const boots = mat(0x1e1c18);
    const vest = mat(s.vest);
    const shirt = mat(s.shirt, camo(s.shirt));
    const gear = mat(0x2a2822);
    const glove = mat(s.gloves);
    const [lw] = BODY_HALF.legs;
    for (const side of [-1, 1]) {
      // Joints are plain groups so the scaled limb meshes don't pass their scale down the chain.
      const hip = new THREE.Group();
      hip.position.set(side * lw * 0.5, 0, 0);
      this.hips.add(hip);
      part(hip, pants, 8, THIGH, 8.4, 0, 0, 0, limb);
      const knee = new THREE.Group();
      knee.position.set(0, -THIGH, 0);
      hip.add(knee);
      part(knee, pants, 6.8, 6.8, 6.8, 0, 0, 0, sphere);
      part(knee, pants, 6.6, SHIN, 7, 0, 0, 0, limb);
      // Feet hang off an ankle joint so they can stay flat on the floor.
      const ankle = new THREE.Group();
      ankle.position.set(0, -SHIN, 0);
      knee.add(ankle);
      part(ankle, boots, 6, 4, 6.2, 0, 0.5, 0);
      part(ankle, boots, 6.2, FOOT + 1, 11, 0, -FOOT / 2, -2.2);
      this.legs.push({ hip, knee, ankle });
    }
    this.hips.add(this.torso);
    // Torso: shirt underneath, vest over the chest, belt with pouches, neck.
    this.stomach = part(this.torso, shirt, 1, 1, 1, 0, 0, 0);
    this.chest = part(this.torso, vest, 1, 1, 1, 0, 0, 0);
    this.belt = part(this.torso, gear, 1, 1, 1, 0, 0, 0);
    this.pouches = new THREE.Group();
    for (const x of [-5.5, 0, 5.5]) part(this.pouches, gear, 4.2, 5, 2.4, x, 0, 0);
    this.torso.add(this.pouches);
    this.neck = part(this.torso, mat(s.skin), 4.6, 4, 4.6, 0, 0, 0, disc);
    this.head = buildHead(s);
    this.torso.add(this.head);
    const arm = (): Arm => ({
      upper: part(this.torso, shirt, 5, 1, 5, 0, 0, 0, limb),
      fore: part(this.torso, shirt, 4.4, 1, 4.4, 0, 0, 0, limb),
      hand: part(this.torso, glove, 3.4, 4, 3, 0, 0, 0),
    });
    this.armL = arm();
    this.armR = arm();
    // Round shoulders and elbows so the arms grow out of the torso instead of floating.
    for (const side of [-1, 1]) part(this.torso, shirt, 7, 7, 7, side * 9, 0, 0, sphere).name = side < 0 ? 'padL' : 'padR';
    this.elbows = [part(this.torso, shirt, 4.8, 4.8, 4.8, 0, 0, 0, sphere), part(this.torso, shirt, 4.8, 4.8, 4.8, 0, 0, 0, sphere)];
    this.torso.add(this.gunHolder);
    this.gunId = null;
    // Remember each material's own colour so lighting can scale it without drifting.
    this.mats = [];
    this.body.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshLambertMaterial | undefined;
      if (m?.color && !this.mats.includes(m)) {
        m.userData.base = m.color.clone();
        this.mats.push(m);
      }
    });
    this.light = -1;
  }

  /** Match the baked lighting where the player stands: dimmer in shade, as 1.6 lit models from the lightmap. */
  setLight(k: number): void {
    if (Math.abs(k - this.light) < 0.01) return;
    this.light = k;
    for (const m of this.mats) m.color.copy(m.userData.base).multiplyScalar(k);
  }

  update(p: PoseInput, x: number, y: number, z: number, dt: number, time: number): void {
    const key = `${p.team}:${p.model}`;
    if (key !== this.skinKey) {
      this.skinKey = key;
      this.build(skinFor(p.team, p.model));
    }
    this.root.position.set(x, y, z);
    this.root.rotation.y = p.yaw * DEG;
    this.blob.visible = p.onGround && p.alive;
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
    this.stomach.scale.set(sw * 2 - 1, s1 - s0 + 4, sd * 2 - 1);
    this.chest.position.set(0, (c0 + c1) / 2 - hipY, -0.3);
    this.chest.scale.set(cw * 2 - 1.5, c1 - c0 + 1, cd * 2 + 0.6);
    this.belt.position.set(0, s0 - hipY + 1, 0);
    this.belt.scale.set(sw * 2 + 0.4, 2.4, sd * 2 + 0.4);
    this.pouches.position.set(0, (c0 + c1) / 2 - hipY - 2, -cd - 0.8);
    this.neck.position.set(0, c1 - hipY + 1, -0.5);
    this.head.position.set(0, (h0 + h1) / 2 - hipY + 0.5, -1);
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
    this.elbows[0].position.copy(this.ik(this.armR, new THREE.Vector3(cw - 1, shoulderY, 0), grip, new THREE.Vector3(1, -1, 0.3)));
    this.elbows[1].position.copy(this.ik(this.armL, new THREE.Vector3(-(cw - 1), shoulderY, 0), fore, new THREE.Vector3(-1, -1.2, 0.2)));

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
  private ik(arm: Arm, shoulder: THREE.Vector3, hand: THREE.Vector3, pole: THREE.Vector3): THREE.Vector3 {
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
    arm.hand.quaternion.copy(arm.fore.quaternion);
    return elbow;
  }

  private bone(m: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3): void {
    const v = to.clone().sub(from);
    const len = Math.max(1, v.length());
    m.position.copy(from);
    m.quaternion.setFromUnitVectors(DOWN, v.normalize());
    m.scale.y = len;
  }
}
