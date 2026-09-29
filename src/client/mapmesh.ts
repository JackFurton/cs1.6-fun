import * as THREE from 'three';
import type { Brush, Plane } from '../engine/brush';
import { Vec3, cross } from '../engine/vec';
import { NUKE_WAVE_SPEED } from '../game/nuke';
import { layoutLightmap, type LightmapLayout } from './lightbake';
import { getTexture, textureScale } from './textures';

export interface Face {
  verts: Vec3[];
  normal: Vec3;
  brush: Brush;
}

/** Polygon for each plane of a convex brush, clipped by all the other planes. */
export function brushFaces(brush: Brush): Face[] {
  const faces: Face[] = [];
  for (const p of brush.planes) {
    let poly = baseWinding(p);
    for (const q of brush.planes) {
      if (q === p) continue;
      poly = clipPoly(poly, q);
      if (poly.length < 3) break;
    }
    if (poly.length >= 3 && polyArea(poly) > 0.5) faces.push({ verts: poly, normal: p.normal, brush });
  }
  return faces;
}

function baseWinding(p: Plane): Vec3[] {
  const n = p.normal;
  const up = Math.abs(n.y) > 0.9 ? new Vec3(0, 0, 1) : new Vec3(0, 1, 0);
  const r = cross(up, n);
  r.normalize();
  const u = cross(n, r);
  const c = n.clone().scale(p.dist);
  const S = 65536;
  // Counter-clockwise seen from the front (along -normal).
  return [
    c.clone().addScaled(r, -S).addScaled(u, -S),
    c.clone().addScaled(r, S).addScaled(u, -S),
    c.clone().addScaled(r, S).addScaled(u, S),
    c.clone().addScaled(r, -S).addScaled(u, S),
  ];
}

/** Keep the part of the polygon behind plane q (inside the brush). */
function clipPoly(poly: Vec3[], q: Plane): Vec3[] {
  const out: Vec3[] = [];
  const eps = 0.01;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const da = a.dot(q.normal) - q.dist;
    const db = b.dot(q.normal) - q.dist;
    if (da <= eps) out.push(a);
    if ((da < -eps && db > eps) || (da > eps && db < -eps)) {
      const t = da / (da - db);
      out.push(new Vec3().lerpVectors(a, b, t));
    }
  }
  return out;
}

function polyArea(poly: Vec3[]): number {
  const acc = new Vec3();
  for (let i = 1; i + 1 < poly.length; i++) {
    const e1 = poly[i].clone().sub(poly[0]);
    const e2 = poly[i + 1].clone().sub(poly[0]);
    acc.add(cross(e1, e2));
  }
  return acc.length() / 2;
}

function faceUV(v: Vec3, n: Vec3, scale: number): [number, number] {
  const ax = Math.abs(n.x);
  const ay = Math.abs(n.y);
  const az = Math.abs(n.z);
  if (ay >= ax && ay >= az) return [v.x / scale, -v.z / scale];
  if (ax >= az) return [(n.x > 0 ? -v.z : v.z) / scale, v.y / scale];
  return [(n.z > 0 ? v.x : -v.x) / scale, v.y / scale];
}

function fitUV(v: Vec3, n: Vec3, b: Brush): [number, number] {
  const size = new Vec3().copy(b.max).sub(b.min);
  const rel = new Vec3().copy(v).sub(b.min);
  const ax = Math.abs(n.x);
  const ay = Math.abs(n.y);
  const az = Math.abs(n.z);
  if (ay >= ax && ay >= az) return [rel.x / size.x, rel.z / size.z];
  if (ax >= az) return [rel.z / size.z, rel.y / size.y];
  return [rel.x / size.x, rel.y / size.y];
}

const MAP_VERT = /* glsl */ `
  attribute vec2 uv1;
  attribute vec3 ruin;
  uniform vec4 blast;
  varying vec2 vUv;
  varying vec2 vUv1;
  varying float vBurn;
  varying float vHeat;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vUv1 = uv1;
    vec3 p = position;
    vBurn = 0.0;
    vHeat = 0.0;
    if (blast.w >= 0.0) {
      float arrived = blast.w - distance(position.xz, blast.xz) / ${NUKE_WAVE_SPEED.toFixed(1)};
      vBurn = smoothstep(0.0, 0.8, arrived);
      vHeat = step(0.0, arrived) * exp(-max(0.0, arrived) * 1.8);
      p = mix(position, ruin, vBurn);
    }
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const MAP_FRAG = /* glsl */ `
  uniform sampler2D map;
  uniform sampler2D lightMap;
  uniform float opacity;
  varying vec2 vUv;
  varying vec2 vUv1;
  varying float vBurn;
  varying float vHeat;
  #include <fog_pars_fragment>
  void main() {
    vec4 albedo = texture2D(map, vUv);
    // Lightmap stores sqrt(light / 2); square it back out.
    vec3 l = texture2D(lightMap, vUv1).rgb;
    vec3 lit = albedo.rgb * l * l * 2.0;
    float grey = dot(lit, vec3(0.3, 0.59, 0.11));
    lit = mix(lit, grey * vec3(0.23, 0.19, 0.16), vBurn);
    lit += vec3(1.6, 0.55, 0.08) * vHeat;
    gl_FragColor = vec4(lit, opacity);
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export interface MapMeshes {
  group: THREE.Group;
  layout: LightmapLayout;
  /** Swap in a baked lightmap once it's ready. */
  setLightmap(tex: THREE.Texture): void;
  /** Visual destruction after a map-wide blast; spawning restores the normal collision geometry. */
  setBlast(pos: Vec3 | null, age: number): void;
}

/**
 * Map geometry lit entirely by a baked lightmap, the way GoldSrc drew its world: one texture
 * lookup for the surface, one for the light, no realtime lights. Much cheaper per pixel than
 * Lambert plus a shadow map, which is what matters on laptops.
 */
/** Every visible map face grouped by texture. Deterministic, so the bake worker gets the same layout. */
export function collectFaces(brushes: Brush[]): Map<string, Face[]> {
  const byTex = new Map<string, Face[]>();
  for (const b of brushes) {
    if (b.clip) continue;
    for (const f of brushFaces(b)) {
      // Nobody ever sees the underside of the ground.
      if (f.normal.y < -0.99 && f.verts[0].y <= 0.5) continue;
      let list = byTex.get(b.tex);
      if (!list) byTex.set(b.tex, (list = []));
      list.push(f);
    }
  }
  return byTex;
}

export function mapLayout(brushes: Brush[], luxel: number): LightmapLayout {
  return layoutLightmap([...collectFaces(brushes).values()].flat(), luxel);
}

export function buildMapMeshes(brushes: Brush[], anisotropy: number, luxel: number, flat: THREE.Texture): MapMeshes {
  const group = new THREE.Group();
  const byTex = collectFaces(brushes);
  const layout = layoutLightmap([...byTex.values()].flat(), luxel);
  const lightMap = { value: flat };
  const blast = { value: new THREE.Vector4(0, 0, 0, -1) };
  const fog = THREE.UniformsUtils.clone(THREE.UniformsLib.fog);

  for (const [tex, faces] of byTex) {
    const pos: number[] = [];
    const uv: number[] = [];
    const uv1: number[] = [];
    const ruin: number[] = [];
    const scale = textureScale(tex);
    for (const f of faces) {
      const uvs = f.verts.map((v) => (f.brush.fit ? fitUV(v, f.normal, f.brush) : faceUV(v, f.normal, scale)));
      for (let i = 1; i + 1 < f.verts.length; i++) {
        for (const k of [0, i, i + 1]) {
          const v = f.verts[k];
          pos.push(v.x, v.y, v.z);
          const b = f.brush;
          const height = b.max.y - b.min.y;
          const collapse = b.max.y > 24;
          // Each wall or prop becomes a low pile. Flat ground stays in place and gets scorched.
          const seed = Math.sin(b.min.x * 0.017 + b.min.z * 0.031 + b.max.y) * 0.5 + 0.5;
          ruin.push(
            v.x + (collapse ? (seed - 0.5) * 70 : 0),
            collapse ? Math.min(b.min.y, 12) + (v.y - b.min.y) * Math.min(0.14, (12 + seed * 20) / Math.max(1, height)) : v.y,
            v.z + (collapse ? Math.cos(b.min.x + b.min.z) * 35 : 0),
          );
          uv.push(uvs[k][0], uvs[k][1]);
          uv1.push(...layout.uv(f, v));
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('uv1', new THREE.Float32BufferAttribute(uv1, 2));
    geo.setAttribute('ruin', new THREE.Float32BufferAttribute(ruin, 3));
    geo.computeBoundingSphere();
    const glass = tex === 'glass';
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...fog, map: { value: getTexture(tex, anisotropy) }, lightMap, blast, opacity: { value: glass ? 0.35 : 1 } },
      vertexShader: MAP_VERT,
      fragmentShader: MAP_FRAG,
      fog: true,
      transparent: glass,
      depthWrite: !glass,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `map:${tex}`;
    group.add(mesh);
  }
  return {
    group,
    layout,
    setLightmap(tex) {
      lightMap.value = tex;
    },
    setBlast(pos, age) {
      blast.value.set(pos?.x ?? 0, pos?.y ?? 0, pos?.z ?? 0, pos ? age : -1);
    },
  };
}
