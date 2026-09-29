import * as THREE from 'three';
import type { WeaponId } from '../game/weapons';

// Low-poly box guns. Barrel points down -Z, origin at the grip, units match the world (inches).

const mats = new Map<number, THREE.MeshLambertMaterial>();
function mat(color: number): THREE.MeshLambertMaterial {
  let m = mats.get(color);
  if (!m) mats.set(color, (m = new THREE.MeshLambertMaterial({ color })));
  return m;
}

const unitBox = new THREE.BoxGeometry(1, 1, 1);

function part(g: THREE.Group, color: number, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0): THREE.Mesh {
  const m = new THREE.Mesh(unitBox, mat(color));
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  m.rotation.x = rx;
  g.add(m);
  return m;
}

const BLACK = 0x1c1c1e;
const GUNMETAL = 0x34363a;
const WOOD = 0x6b4424;
const TAN = 0x8a7a5a;
const SILVER = 0x9a9ca0;
const OLIVE = 0x4a4e3a;

interface Spec {
  /** Where the muzzle is, for flashes and tracers. */
  muzzle: THREE.Vector3;
}

function pistol(g: THREE.Group, color: number, len = 8, slide = GUNMETAL): Spec {
  part(g, color, 1.3, 4, 1.6, 0, -1.4, 0.4, -0.25);
  part(g, slide, 1.4, 1.6, len, 0, 1.2, -len / 2 + 1.5);
  part(g, BLACK, 0.4, 1, 2, 0, -0.2, -0.5);
  return { muzzle: new THREE.Vector3(0, 1.2, -len + 1.5) };
}

function rifle(g: THREE.Group, o: { body: number; stock: number; furniture?: number; len: number; mag?: 'curved' | 'straight' | 'drum' | 'none'; scope?: boolean; stockLen?: number }): Spec {
  const L = o.len;
  part(g, o.furniture ?? o.body, 1.4, 3.4, 1.4, 0, -1.6, 0.6, -0.3); // grip
  part(g, o.body, 1.8, 2.4, 11, 0, 1.2, -3); // receiver
  part(g, o.furniture ?? o.body, 1.9, 2, L * 0.35, 0, 0.9, -8.5 - L * 0.17); // handguard
  part(g, GUNMETAL, 0.6, 0.6, L * 0.55, 0, 1.4, -8.5 - L * 0.27); // barrel
  part(g, o.stock, 1.5, 2.6, o.stockLen ?? 8, 0, 0.6, 2.5 + (o.stockLen ?? 8) / 2); // stock
  switch (o.mag ?? 'straight') {
    case 'curved':
      part(g, o.body, 1.2, 5, 1.8, 0, -2.2, -4.5, 0.35);
      break;
    case 'straight':
      part(g, o.body, 1.2, 4.2, 1.6, 0, -1.8, -4.2, 0.1);
      break;
    case 'drum':
      part(g, OLIVE, 3.5, 4, 4.5, 0, -2.2, -3.5);
      break;
  }
  if (o.scope) {
    part(g, BLACK, 1.3, 1.3, 9, 0, 3.4, -3);
    part(g, BLACK, 1.8, 1.8, 1.5, 0, 3.4, -7.5);
    part(g, BLACK, 0.6, 1, 0.6, 0, 2.6, -1);
  }
  return { muzzle: new THREE.Vector3(0, 1.4, -8.5 - L * 0.55) };
}

function knife(g: THREE.Group): Spec {
  part(g, BLACK, 1.1, 1.3, 4.5, 0, 0, 0.5);
  part(g, SILVER, 0.3, 1.5, 7, 0, 0.3, -5.5);
  part(g, GUNMETAL, 1.8, 1.8, 0.4, 0, 0, -1.8);
  return { muzzle: new THREE.Vector3(0, 0, -9) };
}

function grenade(g: THREE.Group, color: number): Spec {
  part(g, color, 2.6, 3.6, 2.6, 0, 0, 0);
  part(g, SILVER, 1, 1, 1, 0, 2.2, 0);
  return { muzzle: new THREE.Vector3(0, 0, -2) };
}

function c4(g: THREE.Group): Spec {
  part(g, 0x7a6a4a, 5, 2, 7, 0, 0, 0);
  part(g, 0x202020, 3, 0.6, 2.5, 0, 1.2, -1);
  part(g, 0x30ff30, 0.6, 0.3, 0.6, 1, 1.6, 1.5);
  return { muzzle: new THREE.Vector3(0, 0, -4) };
}

/** A handheld take on the Aeon Silencer: ivory armor, swept pods, and green launch hardware. */
function silencer(g: THREE.Group): Spec {
  const ivory = 0xd9ddd0;
  const green = 0x537852;
  part(g, GUNMETAL, 1.7, 4.5, 2, 0, -1.5, 0.8, -0.2);
  part(g, green, 4.2, 3.8, 17, 0, 1.9, -4.5);
  part(g, ivory, 4.6, 1.2, 15, 0, 4, -4.5);
  for (const side of [-1, 1]) {
    const pod = new THREE.Mesh(new THREE.CapsuleGeometry(1.6, 15, 4, 10), mat(ivory));
    pod.rotation.x = Math.PI / 2;
    pod.position.set(side * 3.2, 2, -6);
    g.add(pod);
    part(g, green, 0.35, 2, 11, side * 4.7, 2, -6);
    const emitter = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.4, 12), new THREE.MeshBasicMaterial({ color: 0x9bff69 }));
    emitter.rotation.x = Math.PI / 2;
    emitter.position.set(side * 3.2, 2, -15.3);
    g.add(emitter);
  }
  part(g, BLACK, 3, 0.4, 3.8, 0, 4.8, 0.7, 0.3);
  const screen = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.12, 2.8), new THREE.MeshBasicMaterial({ color: 0x66d960 }));
  screen.position.set(0, 5.1, 0.7);
  screen.rotation.x = 0.3;
  g.add(screen);
  part(g, 0xc54428, 0.7, 0.5, 0.7, 1.1, 4.9, 2.7);
  part(g, ivory, 2.7, 2.5, 5, 0, 0.8, 6.5);
  return { muzzle: new THREE.Vector3(0, 2, -16) };
}

export function buildWeaponModel(id: WeaponId): { group: THREE.Group; muzzle: THREE.Vector3 } {
  const g = new THREE.Group();
  let spec: Spec;
  switch (id) {
    case 'silencer':
      spec = silencer(g);
      break;
    case 'knife':
      spec = knife(g);
      break;
    case 'glock':
      spec = pistol(g, BLACK, 7.5, BLACK);
      break;
    case 'usp':
      spec = pistol(g, BLACK, 8.5);
      break;
    case 'p228':
      spec = pistol(g, BLACK, 7.5, SILVER);
      break;
    case 'deagle':
      spec = pistol(g, SILVER, 10.5, SILVER);
      break;
    case 'fiveseven':
      spec = pistol(g, OLIVE, 8, BLACK);
      break;
    case 'elite':
      spec = pistol(g, BLACK, 8.5, SILVER);
      break;
    case 'm3':
    case 'xm1014':
      spec = rifle(g, { body: BLACK, stock: BLACK, len: 22, mag: 'none', furniture: GUNMETAL });
      break;
    case 'mac10':
    case 'tmp':
      spec = rifle(g, { body: BLACK, stock: BLACK, len: 5, stockLen: 2 });
      break;
    case 'mp5':
      spec = rifle(g, { body: BLACK, stock: BLACK, len: 10, mag: 'curved', stockLen: 6 });
      break;
    case 'ump45':
      spec = rifle(g, { body: GUNMETAL, stock: BLACK, len: 11, stockLen: 7 });
      break;
    case 'p90':
      spec = rifle(g, { body: 0x3c3c34, stock: 0x3c3c34, len: 8, mag: 'none', stockLen: 6 });
      break;
    case 'galil':
      spec = rifle(g, { body: GUNMETAL, stock: BLACK, len: 18, mag: 'curved', furniture: 0x5a4a30 });
      break;
    case 'famas':
      spec = rifle(g, { body: 0x3a3c36, stock: 0x3a3c36, len: 15, stockLen: 4 });
      break;
    case 'ak47':
      spec = rifle(g, { body: GUNMETAL, stock: WOOD, furniture: WOOD, len: 20, mag: 'curved' });
      break;
    case 'm4a1':
      spec = rifle(g, { body: BLACK, stock: BLACK, len: 19 });
      break;
    case 'sg552':
      spec = rifle(g, { body: 0x2a2c2a, stock: 0x2a2c2a, len: 16, mag: 'curved', scope: true });
      break;
    case 'aug':
      spec = rifle(g, { body: OLIVE, stock: OLIVE, len: 18, scope: true, stockLen: 4 });
      break;
    case 'scout':
      spec = rifle(g, { body: GUNMETAL, stock: BLACK, len: 26, mag: 'none', scope: true, stockLen: 9 });
      break;
    case 'awp':
      spec = rifle(g, { body: 0x3a4a30, stock: 0x3a4a30, len: 30, scope: true, stockLen: 10 });
      break;
    case 'g3sg1':
    case 'sg550':
      spec = rifle(g, { body: BLACK, stock: TAN, len: 26, scope: true, stockLen: 9 });
      break;
    case 'm249':
      spec = rifle(g, { body: GUNMETAL, stock: BLACK, len: 24, mag: 'drum', stockLen: 9 });
      break;
    case 'hegrenade':
      spec = grenade(g, 0x3a4a2a);
      break;
    case 'flashbang':
      spec = grenade(g, 0x9a9a9a);
      break;
    case 'smokegrenade':
      spec = grenade(g, 0x5a6a7a);
      break;
    case 'c4':
      spec = c4(g);
      break;
  }
  return { group: g, muzzle: spec.muzzle };
}
