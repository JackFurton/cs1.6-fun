import * as THREE from 'three';
import { NUKE_FLIGHT_TIME, NUKE_WAVE_SPEED, type NuclearStrike } from '../game/nuke';
import type { MapData } from '../maps/types';
import type { Renderer } from './renderer';

const STEM = 26;
const CAP = 64;
const GOLDEN_ANGLE = 2.399963;
const clamp = (v: number) => Math.max(0, Math.min(1, v));

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const gradient = ctx.createRadialGradient(32, 32, 1, 32, 32, 32);
  gradient.addColorStop(0, '#fff');
  gradient.addColorStop(0.2, 'rgba(255,240,210,0.85)');
  gradient.addColorStop(0.55, 'rgba(255,200,130,0.3)');
  gradient.addColorStop(1, 'rgba(255,150,70,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** All animation is driven by the strike's server clock, including clients joining mid-strike. */
export class NukeStrike {
  private root = new THREE.Group();
  private missile = new THREE.Group();
  private cloud: THREE.InstancedMesh<THREE.SphereGeometry, THREE.MeshLambertMaterial>;
  private debris: THREE.InstancedMesh;
  private fragments: { x: number; y: number; z: number; seed: number }[];
  private fireball = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), new THREE.MeshBasicMaterial({ color: 0xffe8af, transparent: true, depthWrite: false, fog: false }));
  private shock = new THREE.Mesh(new THREE.RingGeometry(0.96, 1, 128), new THREE.MeshBasicMaterial({ color: 0xffe4b0, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false }));
  private dust = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 8, 96), new THREE.MeshBasicMaterial({ color: 0xc69c6d, transparent: true, depthWrite: false, fog: false }));
  private target = new THREE.Mesh(new THREE.RingGeometry(90, 96, 64), new THREE.MeshBasicMaterial({ color: 0xff4933, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  private trail: THREE.Sprite[] = [];
  private fires: THREE.Sprite[] = [];
  private overlay: HTMLDivElement;
  private banner: HTMLDivElement;
  private subtitle: HTMLElement;
  private countdown: HTMLElement;
  private flash: HTMLDivElement;
  private matrix = new THREE.Object3D();
  private color = new THREE.Color();
  private hot = new THREE.Color(0xffac42);
  private cold = new THREE.Color(0x665346);
  private active = false;

  constructor(renderer: Renderer, parent: HTMLElement, map: MapData) {
    this.root.name = 'nuclear-strike';
    this.root.visible = false;
    renderer.scene.add(this.root);
    this.buildMissile();
    this.missile.scale.setScalar(1.8);
    this.root.add(this.missile, this.fireball, this.shock, this.dust, this.target);
    this.shock.rotation.x = this.dust.rotation.x = this.target.rotation.x = -Math.PI / 2;
    this.shock.position.y = 18;
    this.target.position.y = 4;

    this.cloud = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xff7020, emissiveIntensity: 0, fog: false }), STEM + CAP);
    this.cloud.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cloud.frustumCulled = false;
    this.root.add(this.cloud);

    const scenery = map.brushes.filter((b) => !b.clip && b.max.y > 24 && b.max.y - b.min.y > 20);
    const count = Math.min(144, scenery.length);
    this.fragments = Array.from({ length: count }, (_, i) => {
      const b = scenery[Math.floor(i * scenery.length / count)];
      return { x: (b.min.x + b.max.x) / 2, y: b.min.y, z: (b.min.z + b.max.z) / 2, seed: (Math.sin(i * 127.1 + 31.7) + 1) / 2 };
    });
    this.debris = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0x514538 }), count);
    this.debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.debris.frustumCulled = false;
    this.root.add(this.debris);

    const glow = glowTexture();
    for (let i = 0; i < 24; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffc17a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      this.trail.push(sprite);
      this.root.add(sprite);
    }
    for (let i = 0; i < Math.min(40, count); i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xff650d, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      this.fires.push(sprite);
      this.root.add(sprite);
    }
    this.overlay = document.createElement('div');
    this.overlay.className = 'nuke-overlay';
    this.overlay.hidden = true;
    this.overlay.innerHTML = `
      <div class="nuke-flash"></div>
      <div class="nuke-banner" role="status">
        <span class="nuke-symbol" aria-hidden="true">☢</span>
        <div class="nuke-copy"><span class="nuke-eyebrow">Strategic weapons alert</span><strong>Strategic launch detected</strong><span class="nuke-subtitle"></span></div>
        <span class="nuke-countdown"></span>
      </div>`;
    parent.appendChild(this.overlay);
    this.banner = this.overlay.querySelector('.nuke-banner')!;
    this.subtitle = this.overlay.querySelector('.nuke-subtitle')!;
    this.countdown = this.overlay.querySelector('.nuke-countdown')!;
    this.flash = this.overlay.querySelector('.nuke-flash')!;
  }

  private buildMissile(): void {
    const hull = new THREE.MeshStandardMaterial({ color: 0xddd9c9, metalness: 0.45, roughness: 0.5 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x252a2c, metalness: 0.65, roughness: 0.5 });
    const red = new THREE.MeshStandardMaterial({ color: 0xa62217, roughness: 0.6 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(19, 23, 150, 16), hull);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(19, 70, 16), dark);
    nose.position.y = 110;
    this.missile.add(body, nose);
    for (const y of [-38, 48]) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(23, 23, 15, 16), red);
      band.position.y = y;
      this.missile.add(band);
    }
    for (let i = 0; i < 4; i++) {
      const angle = i * Math.PI / 2;
      const fin = new THREE.Mesh(new THREE.BoxGeometry(5, 62, 54), dark);
      fin.position.set(Math.sin(angle) * 24, -57, Math.cos(angle) * 24);
      fin.rotation.y = angle;
      this.missile.add(fin);
    }
    for (const [radius, length, opacity] of [[68, 600, 0.18], [27, 320, 0.65]]) {
      const flame = new THREE.Mesh(new THREE.ConeGeometry(radius, length, 12), new THREE.MeshBasicMaterial({ color: 0xffbf65, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      flame.position.y = -85 - length / 2;
      this.missile.add(flame);
    }
    this.missile.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-900, -6400, 650).normalize());
  }

  update(strike: NuclearStrike | null, time: number): void {
    const show = strike !== null;
    if (!show) {
      if (this.active) {
        this.root.visible = false;
        this.overlay.hidden = true;
        this.active = false;
      }
      return;
    }
    this.active = true;
    this.root.visible = true;
    this.overlay.hidden = false;
    this.root.position.set(strike.pos.x, strike.pos.y, strike.pos.z);
    // Never show an impact before the authoritative simulation says it happened.
    const age = strike.exploded ? Math.max(0, time - strike.impactAt) : -1;
    const incoming = !strike.exploded;
    const left = Math.max(0, strike.impactAt - time);
    this.missile.visible = this.target.visible = incoming;
    this.cloud.visible = this.debris.visible = this.fireball.visible = this.shock.visible = this.dust.visible = !incoming;
    this.banner.hidden = !incoming;
    const site = strike.site === 'Arena' ? 'Arena' : `Bombsite ${strike.site}`;
    const sub = `${site} targeted · Warhead inbound`;
    if (this.subtitle.textContent !== sub) this.subtitle.textContent = sub;
    this.countdown.textContent = `T−${left.toFixed(1).padStart(4, '0')}`;
    this.flash.style.opacity = incoming ? '0' : String(clamp(1 - age / 1.1));

    for (const fire of this.fires) fire.visible = !incoming;
    for (let i = 0; i < this.trail.length; i++) {
      const sprite = this.trail[i];
      sprite.visible = incoming;
      if (!incoming) continue;
      const f = clamp(left / NUKE_FLIGHT_TIME) + i * 0.014;
      sprite.position.set(900 * f, 275 + 6400 * f, -650 * f);
      sprite.scale.setScalar(85 + i * 9);
      sprite.material.opacity = 0.28 * (1 - i / this.trail.length);
    }
    if (incoming) {
      const f = clamp(left / NUKE_FLIGHT_TIME);
      this.missile.position.set(900 * f, 260 + 6400 * f, -650 * f);
      this.target.scale.setScalar(1.2 + Math.sin(time * 5) * 0.15);
      this.target.material.opacity = 0.6 + Math.sin(time * 5) * 0.3;
      return;
    }
    this.drawBlast(age, strike);
  }

  private drawBlast(age: number, strike: NuclearStrike): void {
    const growth = 1 - Math.exp(-age / 2);
    const height = 260 + growth * 1750 + age * 35;
    const radius = 180 + growth * 1100;
    this.fireball.position.y = 180;
    this.fireball.scale.setScalar(80 + (1 - Math.exp(-age * 4)) * 1000);
    this.fireball.material.opacity = clamp(1 - age / 1.8);
    this.fireball.visible = age < 1.8;
    this.shock.scale.setScalar(Math.max(1, age * NUKE_WAVE_SPEED));
    this.shock.material.opacity = clamp(1 - age / 5) * 0.8;
    this.dust.scale.set(Math.max(1, age * 1300), Math.max(1, age * 1300), 180);
    this.dust.position.y = 80;
    this.dust.material.opacity = clamp(1 - age / 6) * 0.35;
    this.cloud.material.emissiveIntensity = Math.max(0.03, 1.4 - age * 0.35);

    const m = this.matrix;
    for (let i = 0; i < STEM + CAP; i++) {
      const angle = i * GOLDEN_ANGLE + age * 0.035;
      if (i < STEM) {
        const f = i / (STEM - 1);
        const thick = (90 + f * 180) * (0.5 + growth);
        m.position.set(Math.cos(angle) * thick * 0.25, f * height, Math.sin(angle) * thick * 0.25);
        m.scale.set(thick, 100 + height / STEM * 2, thick);
      } else {
        const f = Math.sqrt((i - STEM) / (CAP - 1));
        const spread = radius * f;
        m.position.set(Math.cos(angle) * spread, height + (1 - f * f) * radius * 0.28 + Math.sin(i * 4.7) * radius * 0.1, Math.sin(angle) * spread);
        const size = (150 + growth * 235) * (0.85 + Math.sin(i * 7.3) * 0.18);
        m.scale.set(size * 1.25, size * 0.85, size * 1.2);
      }
      m.rotation.set(i * 0.9, angle, i * 1.1);
      m.updateMatrix();
      this.cloud.setMatrixAt(i, m.matrix);
      this.color.copy(this.hot).lerp(this.cold, clamp((age - 0.4) / 4 + Math.sin(i * 3.1) * 0.18));
      this.color.multiplyScalar(0.8 + (Math.sin(i * 2.3) + 1) * 0.18);
      this.cloud.setColorAt(i, this.color);
    }
    this.cloud.instanceMatrix.needsUpdate = true;
    if (this.cloud.instanceColor) this.cloud.instanceColor.needsUpdate = true;

    for (let i = 0; i < this.fragments.length; i++) {
      const p = this.fragments[i];
      const dx = p.x - strike.pos.x;
      const dz = p.z - strike.pos.z;
      const distance = Math.hypot(dx, dz);
      const t = Math.max(0, age - distance / NUKE_WAVE_SPEED);
      const travel = Math.min(t, 3) * (100 + p.seed * 220);
      m.position.set(dx + dx / Math.max(1, distance) * travel, p.y - strike.pos.y + Math.max(12, 20 + (300 + p.seed * 600) * t - 240 * t * t), dz + dz / Math.max(1, distance) * travel);
      m.rotation.set(t * (2 + p.seed), i + t, t * 1.7);
      m.scale.setScalar(t > 0 ? 10 + p.seed * 24 : 0);
      m.updateMatrix();
      this.debris.setMatrixAt(i, m.matrix);
      if (i < this.fires.length) {
        const fire = this.fires[i];
        fire.visible = t > 0;
        fire.position.set(dx, p.y - strike.pos.y + 50, dz);
        const flicker = 1 + Math.sin(age * 11 + i * 3.7) * 0.15;
        fire.scale.set((130 + p.seed * 160) * flicker, (160 + p.seed * 220) * flicker, 1);
        fire.material.opacity = clamp(t * 2) * 0.8;
      }
    }
    this.debris.instanceMatrix.needsUpdate = true;
  }

}
