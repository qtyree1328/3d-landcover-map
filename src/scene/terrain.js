import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Build 3D terrain mesh with optional polygon boundary clipping.
 * When a boundary is provided, triangles outside the polygon are removed
 * and a skirt is built from the resulting clipped edge.
 */
export function buildTerrainMesh(elevationData, texture, options = {}) {
  const { width, height, values, min, max } = elevationData;
  const { zScale = 1.5, baseDepth = 0.15, boundary = null, bbox = null } = options;

  const aspect = width / height;
  const range = max - min || 1;

  // Build inside/outside mask if boundary provided
  let insideMask = null;
  if (boundary && bbox) {
    insideMask = buildInsideMask(width, height, boundary, bbox);
  }

  // --- TOP SURFACE ---
  const topGeom = new THREE.PlaneGeometry(1, 1 / aspect, width - 1, height - 1);
  const positions = topGeom.attributes.position.array;
  const heights = computeTerrainHeights(values, min, range, zScale, insideMask, width, height);

  for (let i = 0; i < width * height; i++) {
    positions[i * 3 + 2] = heights[i];
  }

  if (insideMask) {
    const clippedIndex = clipGeometryIndices(topGeom.index.array, insideMask);
    topGeom.setIndex(clippedIndex);
  }
  topGeom.computeVertexNormals();

  // --- SKIRT WALLS ---
  let skirtGeom;
  if (insideMask) {
    skirtGeom = buildMaskSkirtGeometry(positions, topGeom.index.array, baseDepth);
  } else {
    skirtGeom = buildEdgeSkirtGeometry(positions, width, height, aspect, baseDepth);
  }

  // --- BOTTOM FACE ---
  const bottomGeom = new THREE.PlaneGeometry(1, 1 / aspect);
  const bottomPositions = bottomGeom.attributes.position.array;
  for (let i = 0; i < bottomPositions.length / 3; i++) {
    bottomPositions[i * 3 + 2] = -baseDepth;
  }
  const bottomIndex = bottomGeom.index.array;
  for (let i = 0; i < bottomIndex.length; i += 3) {
    const tmp = bottomIndex[i];
    bottomIndex[i] = bottomIndex[i + 2];
    bottomIndex[i + 2] = tmp;
  }
  bottomGeom.computeVertexNormals();

  // Materials
  const topMaterial = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.85,
    metalness: 0.0,
    side: THREE.FrontSide,
    transparent: false,
    alphaTest: 0,
  });

  const wallMaterial = new THREE.MeshStandardMaterial({
    color: 0xd4c9a8,
    roughness: 0.9,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });

  const bottomMaterial = new THREE.MeshStandardMaterial({
    color: 0xb0a68a,
    roughness: 0.9,
    metalness: 0.0,
    side: THREE.FrontSide,
  });

  const hasBoundary = !!(boundary && bbox);

  const topMesh = new THREE.Mesh(topGeom, topMaterial);
  topMesh.castShadow = !hasBoundary; // polygon shadow mesh handles this
  topMesh.receiveShadow = true;

  const skirtMesh = new THREE.Mesh(skirtGeom, wallMaterial);
  skirtMesh.castShadow = !hasBoundary;
  skirtMesh.receiveShadow = true;

  const bottomMesh = new THREE.Mesh(bottomGeom, bottomMaterial);
  bottomMesh.castShadow = !hasBoundary;

  const group = new THREE.Group();
  group.add(topMesh);
  group.add(skirtMesh);
  group.add(bottomMesh);

  // Build polygon-shaped shadow if boundary present
  if (boundary && bbox) {
    const shadowMesh = buildPolygonShadow(boundary, bbox, aspect);
    group.add(shadowMesh);
  }

  group.userData = {
    insideMask,
    boundary,
    bbox,
    hasShadowMesh: !!(boundary && bbox),
    shadowWorldY: SHADOW_WORLD_Y,
  };
  group.rotation.x = -Math.PI / 2;
  updateShadowAnchor(group);

  return group;
}

const SHADOW_WORLD_Y = -0.249;

// ─── Inside mask ───

function buildInsideMask(gridW, gridH, boundary, bbox) {
  const [xmin, ymin, xmax, ymax] = bbox;
  const rings = extractAllRings(boundary);
  const mask = new Uint8Array(gridW * gridH);

  for (let row = 0; row < gridH; row++) {
    for (let col = 0; col < gridW; col++) {
      const u = col / (gridW - 1);
      const v = row / (gridH - 1);
      const lng = xmin + u * (xmax - xmin);
      const lat = ymax - v * (ymax - ymin);
      if (pointInPolygonRings(lng, lat, rings)) {
        mask[row * gridW + col] = 1;
      }
    }
  }
  return mask;
}

function clipGeometryIndices(indexArray, insideMask) {
  const clipped = [];

  for (let i = 0; i < indexArray.length; i += 3) {
    const a = indexArray[i];
    const b = indexArray[i + 1];
    const c = indexArray[i + 2];

    if (insideMask[a] && insideMask[b] && insideMask[c]) {
      clipped.push(a, b, c);
    }
  }

  return clipped;
}

function buildMaskSkirtGeometry(topPositions, topIndex, baseDepth) {
  const edgeMap = new Map();

  for (let i = 0; i < topIndex.length; i += 3) {
    const a = topIndex[i];
    const b = topIndex[i + 1];
    const c = topIndex[i + 2];
    addEdge(edgeMap, a, b);
    addEdge(edgeMap, b, c);
    addEdge(edgeMap, c, a);
  }

  const vertices = [];
  const indices = [];
  const baseZ = -baseDepth;

  for (const edge of edgeMap.values()) {
    if (edge.count !== 1) continue;

    const i0 = edge.a;
    const i1 = edge.b;
    const x0 = topPositions[i0 * 3];
    const y0 = topPositions[i0 * 3 + 1];
    const z0 = topPositions[i0 * 3 + 2];
    const x1 = topPositions[i1 * 3];
    const y1 = topPositions[i1 * 3 + 1];
    const z1 = topPositions[i1 * 3 + 2];

    const vi = vertices.length / 3;
    vertices.push(x0, y0, z0);
    vertices.push(x1, y1, z1);
    vertices.push(x1, y1, baseZ);
    vertices.push(x0, y0, baseZ);

    indices.push(vi, vi + 1, vi + 2);
    indices.push(vi, vi + 2, vi + 3);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  return finalizeSkirtGeometry(geometry);
}

function addEdge(edgeMap, a, b) {
  const min = Math.min(a, b);
  const max = Math.max(a, b);
  const key = `${min}:${max}`;
  const edge = edgeMap.get(key);

  if (edge) {
    edge.count += 1;
    return;
  }

  edgeMap.set(key, { a, b, count: 1 });
}

function finalizeSkirtGeometry(geometry) {
  const merged = mergeVertices(geometry, 1e-6);
  merged.computeVertexNormals();
  return merged;
}

function computeTerrainHeights(values, min, range, zScale, insideMask, width, height) {
  const heights = new Float32Array(values.length);

  for (let i = 0; i < values.length; i++) {
    const normalizedH = (values[i] - min) / range;
    heights[i] = normalizedH * zScale * 0.05;
  }

  if (!insideMask) return heights;
  return smoothBoundaryBandHeights(heights, insideMask, width, height, 2, 2);
}

function smoothBoundaryBandHeights(heights, insideMask, width, height, bandRadius = 2, iterations = 2) {
  const band = buildBoundaryBand(insideMask, width, height, bandRadius);
  if (!band.some(Boolean)) return heights;

  let current = heights;
  let next = new Float32Array(heights);

  for (let iter = 0; iter < iterations; iter++) {
    next.set(current);

    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const idx = row * width + col;
        if (!band[idx]) continue;

        let sum = current[idx];
        let count = 1;

        for (let dy = -1; dy <= 1; dy++) {
          const nr = row + dy;
          if (nr < 0 || nr >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nc = col + dx;
            if (nc < 0 || nc >= width) continue;
            const n = nr * width + nc;
            if (!insideMask[n]) continue;
            sum += current[n];
            count++;
          }
        }

        next[idx] = sum / count;
      }
    }

    const tmp = current;
    current = next;
    next = tmp;
  }

  return current;
}

function buildBoundaryBand(insideMask, width, height, radius) {
  const band = new Uint8Array(insideMask.length);
  let frontier = [];

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const idx = row * width + col;
      if (!insideMask[idx]) continue;
      if (!hasOutsideNeighbor(insideMask, width, height, row, col)) continue;
      band[idx] = 1;
      frontier.push(idx);
    }
  }

  for (let r = 1; r < radius; r++) {
    const next = [];
    for (const idx of frontier) {
      const row = Math.floor(idx / width);
      const col = idx % width;
      const neighbors = [
        [row - 1, col],
        [row + 1, col],
        [row, col - 1],
        [row, col + 1],
      ];
      for (const [nr, nc] of neighbors) {
        if (nr < 0 || nr >= height || nc < 0 || nc >= width) continue;
        const n = nr * width + nc;
        if (!insideMask[n] || band[n]) continue;
        band[n] = 1;
        next.push(n);
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }

  return band;
}

function hasOutsideNeighbor(insideMask, width, height, row, col) {
  const neighbors = [
    [row - 1, col],
    [row + 1, col],
    [row, col - 1],
    [row, col + 1],
  ];

  for (const [nr, nc] of neighbors) {
    if (nr < 0 || nr >= height || nc < 0 || nc >= width) return true;
    const n = nr * width + nc;
    if (!insideMask[n]) return true;
  }

  return false;
}

function pointInPolygonRings(x, y, rings) {
  let inside = false;
  for (const ring of rings) {
    if (pointInRing(x, y, ring)) inside = !inside;
  }
  return inside;
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function extractAllRings(geojson) {
  const rings = [];
  if (geojson.type === 'Polygon') {
    for (const ring of geojson.coordinates) rings.push(ring);
  } else if (geojson.type === 'MultiPolygon') {
    for (const poly of geojson.coordinates) {
      for (const ring of poly) rings.push(ring);
    }
  } else if (geojson.type === 'GeometryCollection' && geojson.geometries) {
    for (const g of geojson.geometries) rings.push(...extractAllRings(g));
  }
  return rings;
}

function extractOuterRings(geojson) {
  const rings = [];
  if (geojson.type === 'Polygon') {
    if (geojson.coordinates[0]) rings.push(geojson.coordinates[0]);
  } else if (geojson.type === 'MultiPolygon') {
    for (const poly of geojson.coordinates) {
      if (poly[0]) rings.push(poly[0]);
    }
  } else if (geojson.type === 'GeometryCollection' && geojson.geometries) {
    for (const g of geojson.geometries) rings.push(...extractOuterRings(g));
  }
  return rings;
}

// ─── Douglas-Peucker simplification ───

function simplifyRing(ring, bbox, tolerance) {
  if (ring.length <= 4) return ring;

  const [xmin, ymin, xmax, ymax] = bbox;
  const geoTolerance = tolerance * Math.max(xmax - xmin, ymax - ymin);

  const simplified = douglasPeucker(ring, geoTolerance);

  // Ensure closed
  if (simplified.length > 2) {
    const first = simplified[0];
    const last = simplified[simplified.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      simplified.push([...first]);
    }
  }
  return simplified;
}

function douglasPeucker(points, epsilon) {
  if (points.length <= 2) return [...points];

  let maxDist = 0;
  let maxIdx = 0;
  const first = points[0];
  const last = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], first, last);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }

  if (maxDist > epsilon) {
    const left = douglasPeucker(points.slice(0, maxIdx + 1), epsilon);
    const right = douglasPeucker(points.slice(maxIdx), epsilon);
    return left.slice(0, -1).concat(right);
  }

  return [first, last];
}

function perpendicularDistance(point, lineStart, lineEnd) {
  const dx = lineEnd[0] - lineStart[0];
  const dy = lineEnd[1] - lineStart[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const ex = point[0] - lineStart[0];
    const ey = point[1] - lineStart[1];
    return Math.sqrt(ex * ex + ey * ey);
  }
  const num = Math.abs(dy * point[0] - dx * point[1] + lineEnd[0] * lineStart[1] - lineEnd[1] * lineStart[0]);
  return num / Math.sqrt(lenSq);
}

// ─── Polygon-shaped shadow on the floor ───

function buildPolygonShadow(boundary, bbox, aspect) {
  const [xmin, ymin, xmax, ymax] = bbox;
  const outerRings = extractOuterRings(boundary);

  const shape = new THREE.Shape();

  for (let r = 0; r < outerRings.length; r++) {
    const ring = simplifyRing(outerRings[r], bbox, 0.002);
    const target = r === 0 ? shape : new THREE.Path();

    for (let i = 0; i < ring.length; i++) {
      const [lng, lat] = ring[i];
      const mx = ((lng - xmin) / (xmax - xmin)) - 0.5;
      const my = ((lat - ymin) / (ymax - ymin) - 0.5) / aspect;

      if (i === 0) target.moveTo(mx, my);
      else target.lineTo(mx, my);
    }

    if (r > 0) shape.holes.push(target);
  }

  const geometry = new THREE.ShapeGeometry(shape);

  // Group rotation is -PI/2 around X: local Z -> world Y.
  // Keep the local Z on the floor plane; updateShadowAnchor preserves this in world space.
  const shadowZ = SHADOW_WORLD_Y;
  const positions = geometry.attributes.position.array;
  for (let i = 0; i < positions.length / 3; i++) {
    positions[i * 3 + 2] = shadowZ;
  }
  geometry.attributes.position.needsUpdate = true;

  const material = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.18,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -1;
  return mesh;
}

// ─── Standard 4-edge skirt (no boundary) ───

function buildEdgeSkirtGeometry(topPositions, gridW, gridH, aspect, baseDepth) {
  const edges = [];
  for (let x = 0; x < gridW - 1; x++) edges.push([x, x + 1]);
  for (let x = 0; x < gridW - 1; x++) edges.push([(gridH - 1) * gridW + x + 1, (gridH - 1) * gridW + x]);
  for (let y = 0; y < gridH - 1; y++) edges.push([(y + 1) * gridW, y * gridW]);
  for (let y = 0; y < gridH - 1; y++) edges.push([y * gridW + (gridW - 1), (y + 1) * gridW + (gridW - 1)]);

  const vertices = [];
  const indices = [];
  for (const [i0, i1] of edges) {
    const x0 = topPositions[i0 * 3], y0 = topPositions[i0 * 3 + 1], z0 = topPositions[i0 * 3 + 2];
    const x1 = topPositions[i1 * 3], y1 = topPositions[i1 * 3 + 1], z1 = topPositions[i1 * 3 + 2];
    const baseZ = -baseDepth;
    const vi = vertices.length / 3;
    vertices.push(x0, y0, z0);
    vertices.push(x1, y1, z1);
    vertices.push(x1, y1, baseZ);
    vertices.push(x0, y0, baseZ);
    indices.push(vi, vi + 1, vi + 2);
    indices.push(vi, vi + 2, vi + 3);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  return finalizeSkirtGeometry(geometry);
}

// ─── Update Z-scale ───

export function updateTerrainZScale(terrainGroup, elevationData, newZScale, baseDepth = 0.15) {
  const topMesh = terrainGroup.children[0];
  const skirtMesh = terrainGroup.children[1];
  const bottomMesh = terrainGroup.children[2];
  const { width, height, values, min, max } = elevationData;
  const range = max - min || 1;
  const insideMask = terrainGroup.userData?.insideMask;
  const hasBoundary = !!insideMask;
  const aspect = width / height;

  const positions = topMesh.geometry.attributes.position.array;
  const heights = computeTerrainHeights(values, min, range, newZScale, insideMask, width, height);
  for (let i = 0; i < values.length; i++) {
    positions[i * 3 + 2] = heights[i];
  }
  topMesh.geometry.attributes.position.needsUpdate = true;
  topMesh.geometry.computeVertexNormals();

  let newSkirtGeom;
  if (hasBoundary) {
    newSkirtGeom = buildMaskSkirtGeometry(positions, topMesh.geometry.index.array, baseDepth);
  } else {
    newSkirtGeom = buildEdgeSkirtGeometry(positions, width, height, aspect, baseDepth);
  }
  skirtMesh.geometry.dispose();
  skirtMesh.geometry = newSkirtGeom;

  const bottomPositions = bottomMesh.geometry.attributes.position.array;
  for (let i = 0; i < bottomPositions.length / 3; i++) {
    bottomPositions[i * 3 + 2] = -baseDepth;
  }
  bottomMesh.geometry.attributes.position.needsUpdate = true;
  bottomMesh.geometry.computeVertexNormals();
}

// ─── Update shadow offset ───

export function updateShadowOffset(terrainGroup, offsetX, offsetZ) {
  if (!terrainGroup?.userData?.hasShadowMesh) return;
  // Shadow mesh is child[3] (after top, skirt, bottom)
  const shadowMesh = terrainGroup.children[3];
  if (!shadowMesh) return;
  // Group is rotated -PI/2 around X: local X -> world X, local Y -> world Z
  // So to move shadow in world XZ, we set local X and Y
  shadowMesh.position.x = offsetX;
  shadowMesh.position.y = offsetZ;
}

export function updateShadowAnchor(terrainGroup) {
  if (!terrainGroup?.userData?.hasShadowMesh) return;
  const shadowMesh = terrainGroup.children[3];
  if (!shadowMesh) return;
  const worldY = terrainGroup.userData.shadowWorldY ?? SHADOW_WORLD_Y;
  // worldY = group.position.y + shadowMesh.localZ (after group rotation)
  shadowMesh.position.z = worldY - terrainGroup.position.y;
}
