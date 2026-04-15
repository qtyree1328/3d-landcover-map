import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export function setupCamera(container) {
  const aspect = container.clientWidth / container.clientHeight;
  const camera = new THREE.PerspectiveCamera(40, aspect, 0.01, 100);

  // Replicate rayshader's oblique view
  camera.position.set(0.8, 0.9, 1.2);
  camera.lookAt(0, 0, 0);

  return camera;
}

export function setupControls(camera, domElement, onChangeCallback) {
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.minDistance = 0.3;
  controls.maxDistance = 5;
  controls.target.set(0, 0, 0);
  controls.maxPolarAngle = Math.PI * 0.85;

  if (onChangeCallback) {
    controls.addEventListener('change', onChangeCallback);
  }

  return controls;
}
