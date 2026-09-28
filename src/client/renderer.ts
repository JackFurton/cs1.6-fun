import * as THREE from 'three';
import { CollisionWorld, Trace } from '../engine/trace';
import { DEG, Vec3 } from '../engine/vec';
import { bakeKey, bakeLightmap, lightmapTexture, lightParams, loadCachedBake, saveCachedBake } from './lightbake';
import type { MapData } from '../maps/types';
import { buildMapMeshes, type MapMeshes } from './mapmesh';
import type { Settings } from './settings';
import type { ViewModel } from './viewmodel';

const QUALITY = {
  low: { luxel: 32, maxDpr: 1, antialias: false },
  medium: { luxel: 20, maxDpr: 1.5, antialias: true },
  high: { luxel: 14, maxDpr: 2, antialias: true },
} as const;

export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private sky: THREE.Mesh;
  /** Scope FOV (4:3 horizontal) overriding the settings FOV while zoomed. */
  private zoomFov: number | null = null;
  private world: CollisionWorld;
  private toSun: Vec3;
  private tr = new Trace();
  onResize: (w: number, h: number) => void = () => {};
  /** Resolves once the lightmap is applied (baked or from cache). */
  readonly lightingReady: Promise<void>;

  constructor(
    container: HTMLElement,
    private settings: Settings,
    map: MapData,
  ) {
    const q = QUALITY[settings.quality];
    this.gl = new THREE.WebGLRenderer({ antialias: q.antialias, powerPreference: 'high-performance' });
    this.gl.autoClear = false;
    container.appendChild(this.gl.domElement);

    this.camera = new THREE.PerspectiveCamera(this.verticalFov(), 1, 2, 16000);
    this.camera.rotation.order = 'YXZ';

    // Only players, guns and props use realtime lights; the map is fully baked.
    const lp = lightParams(map);
    this.scene.add(new THREE.HemisphereLight(lp.sky, lp.ground, map.ambient));
    const sun = new THREE.DirectionalLight(map.sun.color, map.sun.intensity);
    sun.position.set(-map.sun.dir[0], -map.sun.dir[1], -map.sun.dir[2]);
    this.scene.add(sun);
    this.toSun = lp.sunDir.clone().scale(-1);
    this.toSun.normalize();

    this.world = new CollisionWorld(map.brushes.filter((b) => !b.clip), { includeDetail: true });
    const flat = lightmapTexture(1, new Uint8Array([171, 171, 171, 255]));
    const meshes = buildMapMeshes(map.brushes, this.gl.capabilities.getMaxAnisotropy(), q.luxel, flat);
    this.scene.add(meshes.group);
    this.lightingReady = this.bake(map, meshes, lp);

    if (map.fog) this.scene.fog = new THREE.Fog(map.fog[0], map.fog[1], map.fog[2]);
    this.sky = makeSky(map.sky.top, map.sky.horizon);
    this.scene.add(this.sky);

    this.resize();
    addEventListener('resize', () => this.resize());
  }

  /** Lightmap from the IndexedDB cache if this exact map was baked before, otherwise bake and store it. */
  private async bake(map: MapData, meshes: MapMeshes, lp: ReturnType<typeof lightParams>): Promise<void> {
    const { layout } = meshes;
    const key = bakeKey(map, layout.luxel);
    let data = await loadCachedBake(key);
    if (!data || data.length !== layout.size * layout.size * 4) {
      data = await this.bakeInWorker(map.name, layout.luxel, layout.size).catch(() => null);
      if (!data) {
        // No worker (old browser, blocked): bake here, after giving the page a frame to show.
        await new Promise((r) => setTimeout(r, 30));
        const t0 = performance.now();
        data = bakeLightmap(layout, this.world, lp);
        console.info(`baked lightmap on main thread in ${Math.round(performance.now() - t0)}ms`);
      }
      void saveCachedBake(key, data);
    }
    meshes.setLightmap(lightmapTexture(layout.size, data));
  }

  private bakeInWorker(map: string, luxel: number, size: number): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const w = new Worker(new URL('./bakeworker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<{ data: Uint8Array; size: number; ms: number }>) => {
        w.terminate();
        if (e.data.size !== size) return reject(new Error('layout mismatch'));
        console.info(`baked lightmap ${size}px at ${luxel}u in ${Math.round(e.data.ms)}ms (worker)`);
        resolve(e.data.data);
      };
      w.onerror = (err) => {
        w.terminate();
        reject(err);
      };
      w.postMessage({ map, luxel });
    });
  }

  /** 0..1: how much direct sun reaches a point, for lighting players and guns to match the map. */
  sunAt(p: Vec3): number {
    const end = p.clone().addScaled(this.toSun, 6000);
    return this.world.trace(p, end, undefined, undefined, this.tr).fraction >= 1 ? 1 : 0;
  }

  /** 1.6 locks 90 horizontal at 4:3; keep that vertical FOV and let widescreen see more. */
  private verticalFov(): number {
    const fov = this.zoomFov ?? this.settings.fov;
    return 2 * Math.atan(Math.tan((fov / 2) * DEG) * 0.75) / DEG;
  }

  setZoom(fov: number | null): void {
    if (fov === this.zoomFov) return;
    this.zoomFov = fov;
    this.camera.fov = this.verticalFov();
    this.camera.updateProjectionMatrix();
  }

  applySettings(): void {
    this.camera.fov = this.verticalFov();
    this.resize();
  }

  resize(): void {
    // Retina screens at full 2x cost 4x the pixels for little visible gain in a game this chunky.
    this.gl.setPixelRatio(Math.min(devicePixelRatio, QUALITY[this.settings.quality].maxDpr) * this.settings.renderScale);
    this.gl.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.onResize(innerWidth, innerHeight);
  }

  setView(x: number, y: number, z: number, yaw: number, pitch: number, roll = 0): void {
    this.camera.position.set(x, y, z);
    this.camera.rotation.set(pitch * DEG, yaw * DEG, roll * DEG);
    this.sky.position.copy(this.camera.position);
  }

  render(vm?: ViewModel): void {
    this.gl.clear();
    this.gl.render(this.scene, this.camera);
    if (vm) {
      this.gl.clearDepth();
      this.gl.render(vm.scene, vm.camera);
    }
  }
}

function makeSky(top: number, horizon: number): THREE.Mesh {
  const geo = new THREE.SphereGeometry(12000, 32, 16);
  const pos = geo.getAttribute('position');
  const colors: number[] = [];
  const a = new THREE.Color(horizon);
  const b = new THREE.Color(top);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.max(0, pos.getY(i) / 12000);
    c.copy(a).lerp(b, Math.pow(t, 0.6));
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -1;
  return mesh;
}
