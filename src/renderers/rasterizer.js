import * as THREE from 'three';

export function setupRasterizerRenderer(canvas, scene, camera) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.LinearToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  return {
    type: 'rasterizer',
    render: () => renderer.render(scene, camera),
    resize: (w, h) => {
      renderer.setSize(w, h, false);
    },
    getCanvas: () => canvas,
    renderer,
    dispose: () => {
      renderer.dispose();
    },
  };
}
