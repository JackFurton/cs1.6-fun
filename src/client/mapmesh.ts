import * as THREE from 'three';
import type { Brush, Plane } from '../engine/brush';
import { Vec3, cross } from '../engine/vec';
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
  varying vec2 vUv;
  varying vec2 vUv1;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vUv1 = uv1;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
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
  #include <fog_pars_fragment>
  void main() {
    vec4 albedo = texture2D(map, vUv);
    // Lightmap stores sqrt(light / 2); square it back out.
    vec3 l = texture2D(lightMap, vUv1).rgb;
    gl_FragColor = vec4(albedo.rgb * l * l * 2.0, opacity);
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export interface MapMeshes {
  group: THREE.Group;
  layout: LightmapLayout;
  /** Swap in a baked lightmap once it's ready. */
  setLightmap(tex: THREE.Texture): void;
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
  const fog = THREE.UniformsUtils.clone(THREE.UniformsLib.fog);

  for (const [tex, faces] of byTex) {
    const pos: number[] = [];
    const uv: number[] = [];
    const uv1: number[] = [];
    const scale = textureScale(tex);
    for (const f of faces) {
      const uvs = f.verts.map((v) => (f.brush.fit ? fitUV(v, f.normal, f.brush) : faceUV(v, f.normal, scale)));
      for (let i = 1; i + 1 < f.verts.length; i++) {
        for (const k of [0, i, i + 1]) {
          const v = f.verts[k];
          pos.push(v.x, v.y, v.z);
          uv.push(uvs[k][0], uvs[k][1]);
          uv1.push(...layout.uv(f, v));
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('uv1', new THREE.Float32BufferAttribute(uv1, 2));
    geo.computeBoundingSphere();
    const glass = tex === 'glass';
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...fog, map: { value: getTexture(tex, anisotropy) }, lightMap, opacity: { value: glass ? 0.35 : 1 } },
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
  };
}
