import * as THREE from 'three';
import type { Player } from '../game/player';
import type { WeaponId } from '../game/weapons';
import { skinFor } from './skins';
import { buildWeaponModel } from './weaponmodel';


function flashTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,220,1)');
  g.addColorStop(0.3, 'rgba(255,200,80,0.9)');
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
  private bobPhase = 0;
  private swayX = 0;
  private swayY = 0;
  private lastYaw = 0;
  private lastPitch = 0;
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
    const hand = new THREE.MeshLambertMaterial({ color: skin.gloves });
    const box = new THREE.BoxGeometry(1, 1, 1);
    const add = (m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, rx: number, ry = 0) => {
      const mesh = new THREE.Mesh(box, m);
      mesh.scale.set(w, h, d);
      mesh.position.set(x, y, z);
      mesh.rotation.set(rx, ry, 0);
      this.gun.add(mesh);
    };
    // Right hand on the grip, arm running back out of frame.
    add(hand, 2.4, 2.4, 3, 0.2, -1.8, 0.6, 0);
    add(sleeve, 3.2, 3.2, 14, 1.2, -4, 8, 0.35, -0.1);
    const pistolLike = ['glock', 'usp', 'p228', 'deagle', 'fiveseven', 'elite', 'knife', 'hegrenade', 'flashbang', 'smokegrenade', 'c4'].includes(id);
    if (pistolLike) {
      add(hand, 2.4, 2.2, 2.6, -1, -1.6, 0.2, 0);
      add(sleeve, 3.2, 3.2, 14, -4, -4, 7, 0.35, 0.35);
    } else {
      add(hand, 2.4, 2.2, 3, -0.4, -0.2, -10, 0);
      add(sleeve, 2.6, 2.6, 12, -5, -3.2, -5.5, 0.35, 0.8);
    }
  }

  onShot(): void {
    this.kick = 1;
    this.flashTime = 0.045;
    this.flash.rotation.z = Math.random() * Math.PI;
    const s = 5 + Math.random() * 3;
    this.flash.scale.set(s, s, s);
  }

  onKnife(): void {
    this.slash = 1;
    this.slashDir = -this.slashDir;
  }

  update(p: Player, time: number, dt: number, scoped: boolean, silenced: boolean): void {
    const w = p.weapon;
    const id = w?.def.id ?? null;
    if (id !== this.id || p.team !== this.team || p.model !== this.model) this.rebuild(id, p.team, p.model);
    this.holder.visible = p.alive && !!w && !scoped;
    if (!w) return;

    const pistolLike = w.def.slot !== 'primary';
    const base = pistolLike ? new THREE.Vector3(4, -4.3, -12) : new THREE.Vector3(5, -5.2, -13);

    // Bob with movement speed, as cl_bob does.
    const speed = p.move.velocity.length2d();
    if (p.move.onGround) this.bobPhase += dt * (speed / 250) * 11;
    const bobAmt = Math.min(1, speed / 250) * (p.move.onGround ? 1 : 0.3);
    // Kept small and smooth, closer to 1.6's cl_bob 0.01 than a big bounce.
    const bobX = Math.sin(this.bobPhase) * 0.25 * bobAmt;
    const bobY = -Math.abs(Math.cos(this.bobPhase)) * 0.18 * bobAmt;

    // Sway lags behind fast mouse movement.
    let dyaw = p.yaw - this.lastYaw;
    if (dyaw > 180) dyaw -= 360;
    if (dyaw < -180) dyaw += 360;
    const dpitch = p.pitch - this.lastPitch;
    this.lastYaw = p.yaw;
    this.lastPitch = p.pitch;
    const k = 1 - Math.exp(-dt * 12);
    this.swayX += (Math.max(-1.5, Math.min(1.5, dyaw * 0.15)) - this.swayX) * k;
    this.swayY += (Math.max(-1.5, Math.min(1.5, -dpitch * 0.15)) - this.swayY) * k;

    this.kick = Math.max(0, this.kick - dt * 14);
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

    this.holder.position.set(base.x + bobX + this.swayX + slashX, base.y + bobY + this.swayY + dipY + this.kick * 0.4, base.z + this.kick * 1.8);
    this.holder.rotation.set(rotX + this.kick * 0.09, 0.05 + rotY, rotZ);
  }
}
