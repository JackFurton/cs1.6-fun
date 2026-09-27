import * as THREE from 'three';
import { DEG } from '../engine/vec';
import type { MapData } from '../maps/types';
import { buildMapMeshes } from './mapmesh';
import type { Settings } from './settings';
import type { ViewModel } from './viewmodel';

export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private sun: THREE.DirectionalLight;
  private sky: THREE.Mesh;
  /** Scope FOV (4:3 horizontal) overriding the settings FOV while zoomed. */
  private zoomFov: number | null = null;
  onResize: (w: number, h: number) => void = () => {};

  constructor(
    container: HTMLElement,
    private settings: Settings,
    map: MapData,
  ) {
    this.gl = new THREE.WebGLRenderer({ antialias: settings.antialias, powerPreference: 'high-performance' });
    this.gl.shadowMap.enabled = settings.shadows;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    // The map is static, so render the shadow map once instead of every frame.
    this.gl.shadowMap.autoUpdate = false;
    this.gl.shadowMap.needsUpdate = true;
    this.gl.autoClear = false;
    container.appendChild(this.gl.domElement);

    this.camera = new THREE.PerspectiveCamera(this.verticalFov(), 1, 2, 16000);
    this.camera.rotation.order = 'YXZ';

    this.scene.add(new THREE.HemisphereLight(0xdde6f0, 0x8a7458, map.ambient));
    this.sun = new THREE.DirectionalLight(map.sun.color, map.sun.intensity);
    this.scene.add(this.sun, this.sun.target);

    const mapGroup = buildMapMeshes(map.brushes, this.gl.capabilities.getMaxAnisotropy());
    this.scene.add(mapGroup);
    this.fitSun(map, mapGroup);

    if (map.fog) this.scene.fog = new THREE.Fog(map.fog[0], map.fog[1], map.fog[2]);
    this.sky = makeSky(map.sky.top, map.sky.horizon);
    this.scene.add(this.sky);

    this.resize();
    addEventListener('resize', () => this.resize());
  }

  private fitSun(map: MapData, group: THREE.Group): void {
    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    const radius = box.getSize(new THREE.Vector3()).length() / 2;
    const dir = new THREE.Vector3(...map.sun.dir).normalize();
    this.sun.position.copy(center).addScaledVector(dir, -radius * 2);
    this.sun.target.position.copy(center);
    this.sun.castShadow = this.settings.shadows;
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -radius;
    cam.right = cam.top = radius;
    cam.near = radius * 0.5;
    cam.far = radius * 3.5;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 1.5;
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
    this.gl.setPixelRatio(devicePixelRatio * this.settings.renderScale);
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
