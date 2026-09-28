import * as THREE from 'three';
import type { Player } from '../game/player';
import type { WeaponId } from '../game/weapons';
import { skinFor } from './skins';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { buildWeaponModel } from './weaponmodel';


function flashTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,240,200,0.9)');
  g.addColorStop(0.35, 'rgba(255,180,70,0.6)');
  g.addColorStop(1, 'rgba(255,120,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const r = i % 2 ? 12 : 32;
    ctx.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
  }
  ctx.fill();
  return new THREE.CanvasTexture(c);
}

/** First-person weapon, drawn in its own pass so it never clips into walls. */
export class ViewModel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.5, 200);
  private holder = new THREE.Group();
  private gun = new THREE.Group();
  private flash: THREE.Mesh;
  private muzzle = new THREE.Vector3();
  private id: WeaponId | null = null;
  private team: 'T' | 'CT' = 'CT';
  private model = -1;
  private kick = 0;
  private slash = 0;
  private slashDir = 1;
  private flashTime = 0;
  private hemi = new THREE.HemisphereLight(0xffffff, 0x665544, 2.2);
  private sunLight = new THREE.DirectionalLight(0xfff0dd, 1.4);

  /** Dim the gun and arms in shade so they match the world around them. */
  setLight(k: number): void {
    this.hemi.intensity = 2.2 * k;
    this.sunLight.intensity = 1.4 * k;
  }

  constructor() {
    this.scene.add(this.hemi);
    const sun = this.sunLight;
    sun.position.set(-1, 2, 1);
    this.scene.add(sun);
    this.scene.add(this.camera);
    this.camera.add(this.holder);
    this.holder.add(this.gun);
    this.gun.scale.setScalar(0.5);
    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: flashTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.flash.visible = false;
  }

  /** One arm: a gloved hand at `grip`, wrist, then a tapered sleeve up to `elbow` and beyond. */
  private arm(glove: THREE.Material, sleeve: THREE.Material, cuff: THREE.Material, grip: THREE.Vector3, wrist: THREE.Vector3, elbow: THREE.Vector3, r: number, left: boolean): void {
    const seg = (m: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, ra: number, rb: number) => {
      const dir = b.clone().sub(a);
      const len = dir.length();
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rb, ra, len, 12), m);
      mesh.position.copy(a).addScaledVector(dir, 0.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      this.gun.add(mesh);
    };
    const ball = (m: THREE.Material, p: THREE.Vector3, rad: number) => {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(rad, 12, 8), m);
      mesh.position.copy(p);
      this.gun.add(mesh);
    };
    // Palm and a row of fingers curled round the gun, thumb along the side.
    const palm = new THREE.Mesh(new RoundedBoxGeometry(2.6, 3, 2.4, 2, 0.5), glove);
    palm.position.copy(grip);
    palm.lookAt(wrist);
    this.gun.add(palm);
    for (let i = 0; i < 4; i++) {
      const f = new THREE.Mesh(new RoundedBoxGeometry(0.75, 0.75, 2.6, 2, 0.3), glove);
      f.position.set(grip.x + (left ? 1.2 : -1.2), grip.y + 1 - i * 0.8, grip.z - 0.3);
      f.rotation.y = left ? -0.4 : 0.4;
      this.gun.add(f);
    }
    seg(glove, grip, wrist, r * 0.62, r * 0.7);
    seg(cuff, wrist, wrist.clone().lerp(elbow, 0.12), r * 0.95, r * 0.95);
    seg(sleeve, wrist, elbow, r, r * 1.35);
    ball(sleeve, elbow, r * 1.35);
    // Upper arm continuing off-screen so the sleeve never visibly ends.
    seg(sleeve, elbow, elbow.clone().add(new THREE.Vector3(left ? -4 : 4, -10, 6)), r * 1.35, r * 1.5);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  private rebuild(id: WeaponId | null, team: 'T' | 'CT', model: number): void {
    this.gun.clear();
    this.id = id;
    this.team = team;
    this.model = model;
    if (!id) return;
    const { group, muzzle } = buildWeaponModel(id);
    this.gun.add(group);
    this.muzzle.copy(muzzle);
    group.add(this.flash);
    this.flash.position.copy(muzzle);

    // Sleeves and gloves match the chosen character model.
    const skin = skinFor(team, model);
    const sleeve = new THREE.MeshLambertMaterial({ color: skin.shirt });
    const cuff = new THREE.MeshLambertMaterial({ color: new THREE.Color(skin.shirt).multiplyScalar(0.8) });
    const glove = new THREE.MeshLambertMaterial({ color: skin.gloves });
    const pistolLike = ['glock', 'usp', 'p228', 'deagle', 'fiveseven', 'elite', 'knife', 'hegrenade', 'flashbang', 'smokegrenade', 'c4'].includes(id);
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    // Right hand wraps the grip; forearm runs back and down to an elbow below the screen.
    this.arm(glove, sleeve, cuff, V(0.2, -2.2, 0.8), V(0.9, -4.2, 3.2), V(4.5, -13, 16), 1.9, false);
    if (pistolLike) {
      // Support hand cupped under the right one.
      this.arm(glove, sleeve, cuff, V(-1.1, -2.4, 0.2), V(-2.2, -4.4, 2.6), V(-8, -13, 14), 1.8, true);
    } else {
      // Support hand on the handguard, elbow out to the left.
      this.arm(glove, sleeve, cuff, V(-0.2, -0.4, -10), V(-0.9, -2.2, -8), V(-9, -10, 3), 1.8, true);
    }
  }

  onShot(): void {
    this.kick = 1;
    // About two frames at 60fps, like 1.6's muzzle flash sprite.
    this.flashTime = 0.03;
    this.flash.rotation.z = Math.random() * Math.PI;
    const s = 3 + Math.random() * 1.5;
    this.flash.scale.set(s, s, s);
  }

  onKnife(): void {
    this.slash = 1;
    this.slashDir = -this.slashDir;
  }

  update(p: Player, time: number, dt: number, scoped: boolean, silenced: boolean, bob = 0): void {
    const w = p.weapon;
    const id = w?.def.id ?? null;
    if (id !== this.id || p.team !== this.team || p.model !== this.model) this.rebuild(id, p.team, p.model);
    this.holder.visible = p.alive && !!w && !scoped;
    if (!w) return;

    const pistolLike = w.def.slot !== 'primary';
    const base = pistolLike ? new THREE.Vector3(4, -4.3, -12) : new THREE.Vector3(5, -5.2, -13);

    // 1.6 has no mouse sway: the gun is locked to the view. The camera already carries the
    // cl_bob height change, so relative to it the gun only slides forward by 0.4 * bob.
    const bobZ = -bob * 0.4;

    this.kick = Math.max(0, this.kick - dt * 16);
    this.slash = Math.max(0, this.slash - dt * 3.5);
    this.flashTime -= dt;
    this.flash.visible = this.flashTime > 0 && !silenced;

    let dipY = 0;
    let rotX = 0;
    let rotZ = 0;
    const deployT = (time - p.deployedAt) / w.def.deploy;
    if (deployT < 1) {
      const e = 1 - deployT;
      dipY -= e * e * 10;
      rotX -= e * e * 0.9;
    }
    if (w.reloading) {
      const total = w.def.shellReload ?? w.def.reload;
      const t = 1 - Math.max(0, w.reloadEnd - time) / total;
      const s = Math.sin(Math.min(1, t) * Math.PI);
      dipY -= s * 5;
      rotX -= s * 0.5;
      rotZ += s * 0.5;
    }
    let slashX = 0;
    let rotY = 0;
    if (this.slash > 0) {
      const s = Math.sin((1 - this.slash) * Math.PI);
      slashX = -s * 6 * this.slashDir;
      rotY = s * 0.9 * this.slashDir;
      rotX -= s * 0.3;
    }

    this.holder.position.set(base.x + slashX, base.y + dipY + this.kick * 0.25, base.z + bobZ + this.kick * 1.1);
    this.holder.rotation.set(rotX + this.kick * 0.05, 0.05 + rotY, rotZ);
  }
}
