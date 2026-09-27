import * as THREE from 'three';

const app = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setSize(innerWidth, innerHeight);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fb4d8);
const camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 1, 20000);
camera.position.set(0, 64, 300);

scene.add(new THREE.HemisphereLight(0xffffff, 0x554433, 1.2));
const floor = new THREE.Mesh(new THREE.BoxGeometry(1024, 8, 1024), new THREE.MeshLambertMaterial({ color: 0xa08a60 }));
floor.position.y = -4;
scene.add(floor);

renderer.setAnimationLoop(() => renderer.render(scene, camera));
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});
