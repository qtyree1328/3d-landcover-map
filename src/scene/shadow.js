import * as THREE from 'three';

export function createShadowFloor() {
  const geometry = new THREE.PlaneGeometry(6, 6);
  const material = new THREE.ShadowMaterial({
    opacity: 0.2,
    color: 0x000000,
  });
  const floor = new THREE.Mesh(geometry, material);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.25;
  floor.receiveShadow = true;
  return floor;
}
