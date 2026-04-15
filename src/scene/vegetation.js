import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Coordinate system note: this is added as a child of the terrain group, which
// is rotated -PI/2 around X. So the terrain's local +Z is world up. We build
// every tree geometry with its long axis along +Z and base at Z=0, then place
// instances with `localX, localY, terrainHeight` and scale Z by tree height.

const TERRAIN_HEIGHT_FACTOR = 0.05; // matches scene/terrain.js

/**
 * Detect class IDs in the dataset colormap that look like forest/trees.
 * Returns array of { id, hexColor }.
 */
export function detectForestClasses(dataset) {
  if (!dataset || !dataset.colormap) return [];
  const out = [];
  for (const [idStr, entry] of Object.entries(dataset.colormap)) {
    const label = (entry.label || '').toLowerCase();
    if (label.includes('tree') || label.includes('forest') || label.includes('wood')) {
      out.push({ id: parseInt(idStr, 10), hexColor: entry.color });
    }
  }
  return out;
}

/**
 * Build vegetation as a single InstancedMesh added to the terrain group.
 *
 * @returns InstancedMesh whose userData.vegetation holds metadata for later
 *          z-scale updates and disposal.
 */
export function buildVegetation({
  rasterCanvas,        // HTMLCanvasElement of the LULC texture (already drawn)
  forestColors,        // array of '#rrggbb' strings to match in the raster
  elevationData,       // { values, width, height, min, max }
  zScale,
  density = 0.25,      // fraction of detected forest pixels to seed (0..1)
  style = 'cone',      // 'cone' | 'blob' | 'billboard'
  minHeight = 0.006,
  maxHeight = 0.018,
  colorJitter = 0.18,
  maxTrees = 60000,
  baseColor = '#2f6b3d',
  colorTolerance = 18, // RGB distance tolerance per channel
}) {
  if (!rasterCanvas || !elevationData) return null;

  const tw = rasterCanvas.width;
  const th = rasterCanvas.height;
  const ctx = rasterCanvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, tw, th).data;

  // Convert forest colors to [r,g,b]
  const targets = (forestColors && forestColors.length ? forestColors : [baseColor])
    .map(hexToRgb)
    .filter(Boolean);

  // 1. Find candidate forest pixels.
  const candidates = [];
  // Stride: sample every Nth pixel to keep this loop fast on big rasters.
  const stride = Math.max(1, Math.floor(Math.sqrt((tw * th) / Math.max(1, maxTrees * 4))));
  for (let y = 0; y < th; y += stride) {
    for (let x = 0; x < tw; x += stride) {
      const i = (y * tw + x) * 4;
      const r = img[i], g = img[i + 1], b = img[i + 2], a = img[i + 3];
      if (a < 16) continue;
      if (matchesAnyColor(r, g, b, targets, colorTolerance)) {
        candidates.push({ x, y });
      }
    }
  }

  if (candidates.length === 0) return null;

  // 2. Apply density and cap.
  const targetCount = Math.min(maxTrees, Math.max(1, Math.floor(candidates.length * density)));
  const samples = reservoirSample(candidates, targetCount);

  // 3. Build geometry per chosen style.
  const geom = buildTreeGeometry(style);
  const mat = new THREE.MeshStandardMaterial({
    roughness: 0.92,
    metalness: 0.0,
    side: style === 'billboard' ? THREE.DoubleSide : THREE.FrontSide,
    transparent: false,
    vertexColors: true, // multiplies trunk-brown / canopy-white by per-instance tint
  });

  const inst = new THREE.InstancedMesh(geom, mat, samples.length);
  inst.castShadow = true;
  inst.receiveShadow = false;
  inst.frustumCulled = false;

  // 4. Pre-compute terrain mapping.
  const evW = elevationData.width;
  const evH = elevationData.height;
  const ev = elevationData.values;
  const range = (elevationData.max - elevationData.min) || 1;
  const aspect = evW / evH;

  // Per-instance metadata so we can re-place trees when zScale changes
  // without rebuilding the whole mesh: [normalizedH, treeHeight, localX, localY]
  const meta = new Float32Array(samples.length * 4);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const t = new THREE.Vector3();
  const upZ = new THREE.Vector3(0, 0, 1);
  const baseColorObj = new THREE.Color(baseColor);
  const tmpColor = new THREE.Color();

  for (let i = 0; i < samples.length; i++) {
    const { x: px, y: py } = samples[i];

    // Map raster pixel → elevation pixel. Both rasters cover the same bbox.
    const evCol = Math.min(evW - 1, Math.floor((px / tw) * evW));
    const evRow = Math.min(evH - 1, Math.floor((py / th) * evH));
    const elev = ev[evRow * evW + evCol];
    const nh = (elev - elevationData.min) / range;

    // PlaneGeometry(1, 1/aspect) is centered at 0; row 0 = +Y/2 (north).
    const localX = (px / tw) - 0.5;
    const localY = (0.5 - (py / th)) / aspect;
    const localZ = nh * zScale * TERRAIN_HEIGHT_FACTOR;

    const treeH = THREE.MathUtils.lerp(minHeight, maxHeight, Math.random());
    const xyScale = THREE.MathUtils.lerp(0.55, 1.0, Math.random());
    const rotZ = Math.random() * Math.PI * 2;

    t.set(localX, localY, localZ);
    q.setFromAxisAngle(upZ, rotZ);
    s.set(treeH * 0.45 * xyScale, treeH * 0.45 * xyScale, treeH);
    m.compose(t, q, s);
    inst.setMatrixAt(i, m);

    tmpColor.copy(baseColorObj);
    if (colorJitter > 0) {
      const j = (Math.random() - 0.5) * colorJitter;
      tmpColor.offsetHSL(j * 0.06, j * 0.4, j * 0.5);
    }
    inst.setColorAt(i, tmpColor);

    meta[i * 4 + 0] = nh;
    meta[i * 4 + 1] = treeH;
    meta[i * 4 + 2] = localX;
    meta[i * 4 + 3] = localY;
  }

  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;

  inst.userData.vegetation = {
    meta,
    style,
    rotations: null, // recompute Z rotations on update is not needed; matrix already encodes them
  };

  return inst;
}

/**
 * Re-place every tree on a height change without rebuilding geometry.
 * Pulls (localX, localY, normalizedH, treeHeight) out of userData.meta.
 */
export function updateVegetationZScale(instMesh, newZScale) {
  if (!instMesh || !instMesh.userData || !instMesh.userData.vegetation) return;
  const { meta } = instMesh.userData.vegetation;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const t = new THREE.Vector3();
  const s = new THREE.Vector3();
  const count = instMesh.count;

  // Preserve existing rotation + xy scale by reading current matrix.
  const existing = new THREE.Matrix4();
  const existingPos = new THREE.Vector3();
  const existingQuat = new THREE.Quaternion();
  const existingScale = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    const nh = meta[i * 4 + 0];
    const treeH = meta[i * 4 + 1];
    const localX = meta[i * 4 + 2];
    const localY = meta[i * 4 + 3];
    const localZ = nh * newZScale * TERRAIN_HEIGHT_FACTOR;

    instMesh.getMatrixAt(i, existing);
    existing.decompose(existingPos, existingQuat, existingScale);

    t.set(localX, localY, localZ);
    s.set(existingScale.x, existingScale.y, treeH);
    m.compose(t, existingQuat, s);
    instMesh.setMatrixAt(i, m);
  }
  instMesh.instanceMatrix.needsUpdate = true;
}

export function disposeVegetation(instMesh) {
  if (!instMesh) return;
  if (instMesh.parent) instMesh.parent.remove(instMesh);
  if (instMesh.geometry) instMesh.geometry.dispose();
  if (instMesh.material) instMesh.material.dispose();
}

// ---------------------------------------------------------------------------
// Tree geometries — all built with axis along +Z and base at Z=0.

function buildTreeGeometry(style) {
  switch (style) {
    case 'blob':       return buildBlobTree();
    case 'billboard':  return buildBillboardTree();
    case 'cone':
    default:           return buildConeTree();
  }
}

function buildConeTree() {
  // trunk: short brown cylinder
  const trunk = new THREE.CylinderGeometry(0.18, 0.22, 0.35, 5, 1, false);
  trunk.translate(0, 0.35 / 2, 0);
  paintGeometry(trunk, [0.32, 0.22, 0.13]);

  // canopy: narrow cone
  const canopy = new THREE.ConeGeometry(0.55, 0.95, 7, 1, false);
  canopy.translate(0, 0.35 + 0.95 / 2, 0);
  paintGeometry(canopy, [1, 1, 1]); // white -> tinted by InstancedMesh color

  const merged = mergeGeometries([trunk, canopy], false);
  // Rotate so +Y becomes +Z (axis up = +Z in terrain local space).
  merged.rotateX(Math.PI / 2);
  return merged;
}

function buildBlobTree() {
  const trunk = new THREE.CylinderGeometry(0.12, 0.15, 0.25, 5);
  trunk.translate(0, 0.25 / 2, 0);
  paintGeometry(trunk, [0.32, 0.22, 0.13]);

  const canopy = new THREE.IcosahedronGeometry(0.65, 0); // low-poly sphere
  canopy.translate(0, 0.25 + 0.55, 0);
  paintGeometry(canopy, [1, 1, 1]);

  const merged = mergeGeometries([trunk, canopy], false);
  merged.rotateX(Math.PI / 2);
  return merged;
}

function buildBillboardTree() {
  // Two crossed quads forming a "+"; each quad is 1 unit tall, centered on Z axis.
  const w = 1.0, h = 1.0;
  const quadA = new THREE.PlaneGeometry(w, h);
  quadA.translate(0, h / 2, 0);
  paintGeometry(quadA, [1, 1, 1]);

  const quadB = new THREE.PlaneGeometry(w, h);
  quadB.translate(0, h / 2, 0);
  quadB.rotateY(Math.PI / 2);
  paintGeometry(quadB, [1, 1, 1]);

  const merged = mergeGeometries([quadA, quadB], false);
  merged.rotateX(Math.PI / 2);
  return merged;
}

/** Attach a per-vertex color attribute filled with one RGB triple. */
function paintGeometry(geom, rgb) {
  const n = geom.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3 + 0] = rgb[0];
    arr[i * 3 + 1] = rgb[1];
    arr[i * 3 + 2] = rgb[2];
  }
  geom.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}

// ---------------------------------------------------------------------------
// Helpers

function hexToRgb(hex) {
  if (typeof hex !== 'string') return null;
  const h = hex.replace('#', '').trim();
  if (h.length !== 6) return null;
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  if ([r, g, b].some(v => Number.isNaN(v))) return null;
  return [r, g, b];
}

function matchesAnyColor(r, g, b, targets, tol) {
  for (let i = 0; i < targets.length; i++) {
    const [tr, tg, tb] = targets[i];
    if (Math.abs(r - tr) <= tol && Math.abs(g - tg) <= tol && Math.abs(b - tb) <= tol) {
      return true;
    }
  }
  return false;
}

/** Reservoir sample to pick `k` items uniformly without replacement. */
function reservoirSample(arr, k) {
  if (k >= arr.length) return arr.slice();
  const out = arr.slice(0, k);
  for (let i = k; i < arr.length; i++) {
    const j = Math.floor(Math.random() * (i + 1));
    if (j < k) out[j] = arr[i];
  }
  return out;
}
