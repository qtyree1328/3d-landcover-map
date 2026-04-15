import * as THREE from 'three';

// Path tracer setup — uses three-gpu-pathtracer
// This module dynamically imports the library to handle cases where it's unavailable

let PathTracerModule = null;

async function loadPathTracer() {
  if (PathTracerModule) return PathTracerModule;
  try {
    PathTracerModule = await import('three-gpu-pathtracer');
    return PathTracerModule;
  } catch (e) {
    console.warn('three-gpu-pathtracer not available:', e);
    return null;
  }
}

export async function setupPathTracerRenderer(canvas, scene, camera) {
  const mod = await loadPathTracer();

  if (!mod || !mod.WebGLPathTracer) {
    console.warn('Path tracer not available — falling back to rasterizer message');
    return null;
  }

  const { WebGLPathTracer } = mod;

  const pathTracer = new WebGLPathTracer(canvas);
  pathTracer.toneMapping = THREE.ACESFilmicToneMapping;
  pathTracer.toneMappingExposure = 1.2;

  let sampleCount = 0;
  let sceneReady = false;

  // Set scene
  try {
    pathTracer.setScene(scene, camera);
    sceneReady = true;
  } catch (e) {
    console.warn('Path tracer setScene failed:', e);
  }

  return {
    type: 'pathtracer',
    render: () => {
      if (!sceneReady) return 0;
      try {
        pathTracer.renderSample();
        sampleCount++;
      } catch (e) {
        // Silently handle render errors
      }
      return sampleCount;
    },
    reset: () => {
      if (!sceneReady) return;
      try {
        pathTracer.reset();
      } catch (e) {
        // ignore
      }
      sampleCount = 0;
    },
    updateScene: () => {
      try {
        pathTracer.setScene(scene, camera);
        sceneReady = true;
        sampleCount = 0;
      } catch (e) {
        console.warn('Path tracer updateScene failed:', e);
        sceneReady = false;
      }
    },
    getSampleCount: () => sampleCount,
    getCanvas: () => canvas,
    resize: (w, h) => {
      // Path tracer handles resize internally
    },
    dispose: () => {
      try {
        pathTracer.dispose();
      } catch (e) {
        // ignore
      }
    },
  };
}
