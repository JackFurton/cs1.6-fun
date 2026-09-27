import * as THREE from 'three';
import type { Vec3 } from '../engine/vec';

const MAX_DECALS = 256;
const MAX_PARTICLES = 400;

function holeTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(10,8,6,1)');
  g.addColorStop(0.35, 'rgba(25,20,15,0.9)');
  g.addColorStop(0.6, 'rgba(40,35,30,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

function puffTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

interface Particle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  color: THREE.Color;
  gravity: number;
}

/** Bullet holes, dust and blood puffs, tracers. */
export class Effects {
  private decals: THREE.InstancedMesh;
  private decalIndex = 0;
  private particles: Particle[] = [];
  private points: THREE.Points;
  private tracers: { line: THREE.Line; life: number }[] = [];
  private tracerMat = new THREE.LineBasicMaterial({ color: 0xffe8a0, transparent: true, opacity: 0.7 });
  // Fixed pool: adding and removing lights would force three.js to recompile every material.
  private flashes: { light: THREE.PointLight; life: number }[] = [];
  private nextFlash = 0;

  constructor(private scene: THREE.Scene) {
    const mat = new THREE.MeshBasicMaterial({ map: holeTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    this.decals = new THREE.InstancedMesh(new THREE.PlaneGeometry(3, 3), mat, MAX_DECALS);
    this.decals.count = 0;
    this.decals.frustumCulled = false;
    scene.add(this.decals);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3));
    geo.setAttribute('size', new THREE.Float32BufferAttribute(new Float32Array(MAX_PARTICLES), 1));
    const pmat = new THREE.ShaderMaterial({
      uniforms: { map: { value: puffTexture() }, scale: { value: 400 } },
      vertexShader: `
        attribute float size;
        attribute vec3 color;
        varying vec3 vColor;
        varying float vAlpha;
        uniform float scale;
        void main() {
          vColor = color;
          vAlpha = size > 0.0 ? 1.0 : 0.0;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec4 t = texture2D(map, gl_PointCoord);
          gl_FragColor = vec4(vColor, t.a * 0.8 * vAlpha);
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, pmat);
    this.points.frustumCulled = false;
    scene.add(this.points);

    for (let i = 0; i < 2; i++) {
      const light = new THREE.PointLight(0xffc060, 0, 300, 2);
      scene.add(light);
      this.flashes.push({ light, life: 0 });
    }
  }

  setViewportHeight(h: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.scale.value = h * 0.6;
  }

  impact(pos: Vec3, normal: Vec3, tex: string): void {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(normal.x, normal.y, normal.z));
    const r = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.random() * Math.PI * 2);
    q.multiply(r);
    const p = new THREE.Vector3(pos.x + normal.x * 0.2, pos.y + normal.y * 0.2, pos.z + normal.z * 0.2);
    const s = 0.8 + Math.random() * 0.5;
    m.compose(p, q, new THREE.Vector3(s, s, s));
    this.decals.setMatrixAt(this.decalIndex, m);
    this.decalIndex = (this.decalIndex + 1) % MAX_DECALS;
    this.decals.count = Math.min(MAX_DECALS, this.decals.count + 1);
    this.decals.instanceMatrix.needsUpdate = true;

    const wood = tex.startsWith('crate') || tex === 'wood' || tex === 'door';
    const metal = tex.startsWith('metal') || tex.startsWith('container');
    const color = wood ? new THREE.Color(0.55, 0.42, 0.28) : metal ? new THREE.Color(1, 0.85, 0.5) : new THREE.Color(0.7, 0.65, 0.55);
    const n = metal ? 4 : 6;
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(normal.x, normal.y, normal.z).multiplyScalar(40 + Math.random() * 60);
      v.x += (Math.random() - 0.5) * 60;
      v.y += (Math.random() - 0.3) * 60;
      v.z += (Math.random() - 0.5) * 60;
      this.spawn(p.clone(), v, metal ? 0.15 : 0.5 + Math.random() * 0.3, metal ? 1.5 : 5 + Math.random() * 4, color, metal ? 400 : 60);
    }
  }

  blood(pos: Vec3, dir: Vec3): void {
    for (let i = 0; i < 8; i++) {
      const v = new THREE.Vector3(dir.x, dir.y, dir.z).multiplyScalar(30 + Math.random() * 40);
      v.x += (Math.random() - 0.5) * 50;
      v.y += (Math.random() - 0.2) * 50;
      v.z += (Math.random() - 0.5) * 50;
      this.spawn(new THREE.Vector3(pos.x, pos.y, pos.z), v, 0.35 + Math.random() * 0.2, 4 + Math.random() * 4, new THREE.Color(0.55, 0.02, 0.02), 200);
    }
  }

  tracer(from: THREE.Vector3, to: Vec3): void {
    const geo = new THREE.BufferGeometry().setFromPoints([from, new THREE.Vector3(to.x, to.y, to.z)]);
    const line = new THREE.Line(geo, this.tracerMat);
    this.scene.add(line);
    this.tracers.push({ line, life: 0.06 });
  }

  muzzleLight(pos: THREE.Vector3): void {
    const f = this.flashes[this.nextFlash];
    this.nextFlash = (this.nextFlash + 1) % this.flashes.length;
    f.light.position.copy(pos);
    f.life = 0.05;
  }

  private spawn(pos: THREE.Vector3, vel: THREE.Vector3, life: number, size: number, color: THREE.Color, gravity: number): void {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push({ pos, vel, life, maxLife: life, size, color, gravity });
  }

  update(dt: number): void {
    const pos = this.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = this.points.geometry.getAttribute('color') as THREE.BufferAttribute;
    const size = this.points.geometry.getAttribute('size') as THREE.BufferAttribute;
    let n = 0;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.vel.multiplyScalar(1 - dt * 2);
      p.pos.addScaledVector(p.vel, dt);
    }
    for (const p of this.particles) {
      const t = p.life / p.maxLife;
      pos.setXYZ(n, p.pos.x, p.pos.y, p.pos.z);
      col.setXYZ(n, p.color.r, p.color.g, p.color.b);
      size.setX(n, p.size * (1.5 - t * 0.5) * Math.min(1, t * 3));
      n++;
    }
    for (let i = n; i < MAX_PARTICLES; i++) size.setX(i, 0);
    pos.needsUpdate = col.needsUpdate = size.needsUpdate = true;

    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      if (t.life <= 0) {
        this.scene.remove(t.line);
        t.line.geometry.dispose();
        this.tracers.splice(i, 1);
      }
    }
    for (const f of this.flashes) {
      f.life = Math.max(0, f.life - dt);
      f.light.intensity = f.life > 0 ? 3000 : 0;
    }
  }
}
