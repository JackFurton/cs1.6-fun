import * as THREE from 'three';
import type { Brush, Plane } from '../engine/brush';
import { Vec3, cross } from '../engine/vec';
import type { CollisionWorld } from '../engine/trace';
import { bakeAO } from './lightbake';
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

/** Cheap fake lighting baked into vertex colours so faces read apart without real GI. */
function faceShade(n: Vec3): number {
  if (n.y > 0.7) return 1;
  if (n.y < -0.7) return 0.55;
  return 0.78 + 0.1 * n.x - 0.05 * n.z;
}

export function buildMapMeshes(brushes: Brush[], anisotropy: number, world?: CollisionWorld): THREE.Group {
  const group = new THREE.Group();
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

  const ao = world ? bakeAO([...byTex.values()].flat(), world) : null;
  if (ao) console.info(`baked AO: ${ao.luxels} luxels in ${Math.round(ao.ms)}ms`);

  for (const [tex, faces] of byTex) {
    const pos: number[] = [];
    const uv1: number[] = [];
    const nor: number[] = [];
    const uv: number[] = [];
    const col: number[] = [];
    const scale = textureScale(tex);
    for (const f of faces) {
      const shade = faceShade(f.normal);
      const uvs = f.verts.map((v) => (f.brush.fit ? fitUV(v, f.normal, f.brush) : faceUV(v, f.normal, scale)));
      for (let i = 1; i + 1 < f.verts.length; i++) {
        for (const k of [0, i, i + 1]) {
          const v = f.verts[k];
          pos.push(v.x, v.y, v.z);
          nor.push(f.normal.x, f.normal.y, f.normal.z);
          uv.push(uvs[k][0], uvs[k][1]);
          if (ao) uv1.push(...ao.uv(f, v));
          col.push(shade, shade, shade);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    if (ao) geo.setAttribute('uv1', new THREE.Float32BufferAttribute(uv1, 2));
    geo.computeBoundingSphere();
    const mat = new THREE.MeshLambertMaterial({ map: getTexture(tex, anisotropy), vertexColors: true, aoMap: ao?.texture ?? null, aoMapIntensity: 1 });
    // A plain aoMap only darkens fill light, so sunlit corners stay flat. Baked radiosity in 1.6
    // darkened corners for all light, so let the AO also pull down the final colour a bit.
    if (ao)
      mat.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', 'outgoingLight *= mix(1.0, texture2D(aoMap, vAoMapUv).r, 0.7);\n#include <opaque_fragment>');
      };
    if (tex === 'glass') {
      mat.transparent = true;
      mat.opacity = 0.35;
      mat.depthWrite = false;
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `map:${tex}`;
    group.add(mesh);
  }
  return group;
}
