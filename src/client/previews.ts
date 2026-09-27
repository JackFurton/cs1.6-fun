import * as THREE from 'three';
import type { Team } from '../maps/types';
import { PlayerModel } from './playermodel';
import { SKINS } from './skins';

const cache = new Map<Team, string[]>();

/** Standing renders of each character model for the selection screen, made once per team. */
export function skinPreviews(team: Team): string[] {
  const hit = cache.get(team);
  if (hit) return hit;
  const out: string[] = [];
  let r: THREE.WebGLRenderer;
  try {
    r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch {
    return out;
  }
  const W = 200;
  const H = 260;
  r.setSize(W, H);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x554433, 2.2));
  const sun = new THREE.DirectionalLight(0xfff0e0, 2);
  sun.position.set(-2, 3, -3);
  scene.add(sun);
  const cam = new THREE.PerspectiveCamera(30, W / H, 1, 1000);
  cam.position.set(-70, 58, -140);
  cam.lookAt(0, 38, 0);
  for (let i = 0; i < SKINS[team].length; i++) {
    const m = new PlayerModel();
    m.update({ team, model: i, yaw: 50, pitch: 0, alive: true, speed: 0, onGround: true, duck: 0, weapon: team === 'T' ? 'ak47' : 'm4a1', firedAt: -10 }, 0, 0, 0, 0, 0);
    scene.add(m.root);
    r.render(scene, cam);
    out.push(r.domElement.toDataURL());
    scene.remove(m.root);
  }
  r.dispose();
  r.forceContextLoss();
  cache.set(team, out);
  return out;
}
