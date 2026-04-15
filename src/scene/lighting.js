import * as THREE from 'three';

export function setupLighting(scene) {
  // Main directional light for shadows
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.8);
  dirLight.position.set(3, 5, 2);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 4096;
  dirLight.shadow.mapSize.height = 4096;
  dirLight.shadow.camera.near = 0.1;
  dirLight.shadow.camera.far = 20;
  dirLight.shadow.camera.left = -3;
  dirLight.shadow.camera.right = 3;
  dirLight.shadow.camera.top = 3;
  dirLight.shadow.camera.bottom = -3;
  dirLight.shadow.bias = -0.0005;
  dirLight.shadow.radius = 4;
  scene.add(dirLight);

  // Stronger ambient for white background
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  // Hemisphere light — sky white, ground warm
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0xe8dcc8, 0.5);
  scene.add(hemiLight);

  return { dirLight, ambientLight, hemiLight };
}
