import { fromArrayBuffer } from 'geotiff';

const OPEN_TOPO_TILE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';

// Keep stitch canvases under this size (px per side). Hardware texture / canvas
// limits vary by GPU — 8192 is the safe ceiling on almost all desktop browsers.
const MAX_STITCH_SIDE = 8192;

export async function fetchElevation(bbox, width, height, options = {}) {
  const mode = options.mode || 'auto';

  if (mode === 'usgs-3dep') {
    return fetchUSGS3DEPElevation(bbox, width, height);
  }

  if (mode === 'auto' && bboxOverlapsUS(bbox)) {
    try {
      return await fetchUSGS3DEPElevation(bbox, width, height);
    } catch (err) {
      console.warn('[elevation] USGS 3DEP failed, falling back to Terrarium:', err.message);
    }
  }

  return fetchTerrariumElevation(bbox, width, height);
}

async function fetchUSGS3DEPElevation(bbox, width, height) {
  const [xmin, ymin, xmax, ymax] = bbox;
  const url = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage';
  const params = new URLSearchParams({
    bbox: `${xmin},${ymin},${xmax},${ymax}`,
    bboxSR: '4326',
    imageSR: '4326',
    size: `${width},${height}`,
    format: 'tiff',
    pixelType: 'F32',
    noData: '-9999',
    interpolation: 'RSP_BilinearInterpolation',
    f: 'image',
  });

  const resp = await fetch(`${url}?${params}`);
  if (!resp.ok) {
    throw new Error(`USGS 3DEP request failed: ${resp.status}`);
  }

  const arrayBuffer = await resp.arrayBuffer();
  return await decodeTiffElevation(arrayBuffer, width, height, bbox, -9999);
}

async function decodeTiffElevation(buffer, expectedWidth, expectedHeight, bbox, noDataValue) {
  const tiff = await fromArrayBuffer(buffer);
  const image = await tiff.getImage();
  const imageWidth = image.getWidth();
  const imageHeight = image.getHeight();
  const rasters = await image.readRasters();
  const band = rasters[0]; // first band = elevation

  const pixelCount = imageWidth * imageHeight;
  const values = new Float32Array(pixelCount);
  const validMask = new Uint8Array(pixelCount);

  for (let i = 0; i < pixelCount; i++) {
    const v = Number(band[i]);
    values[i] = v;
    if (Number.isFinite(v) && Math.abs(v - noDataValue) > 1e-6 && v > -1e20 && v < 1e20) {
      validMask[i] = 1;
    }
  }

  // Resample to expected dimensions if needed
  if (imageWidth !== expectedWidth || imageHeight !== expectedHeight) {
    const resampled = new Float32Array(expectedWidth * expectedHeight);
    const resampledMask = new Uint8Array(expectedWidth * expectedHeight);
    for (let y = 0; y < expectedHeight; y++) {
      for (let x = 0; x < expectedWidth; x++) {
        const srcX = Math.min(Math.round(x * imageWidth / expectedWidth), imageWidth - 1);
        const srcY = Math.min(Math.round(y * imageHeight / expectedHeight), imageHeight - 1);
        const srcIdx = srcY * imageWidth + srcX;
        const dstIdx = y * expectedWidth + x;
        resampled[dstIdx] = values[srcIdx];
        resampledMask[dstIdx] = validMask[srcIdx];
      }
    }
    return finalizeElevationData(resampled, resampledMask, expectedWidth, expectedHeight, bbox);
  }

  return finalizeElevationData(values, validMask, imageWidth, imageHeight, bbox);
}

async function fetchTerrariumElevation(bbox, width, height) {
  const [xmin, ymin, xmax, ymax] = bbox;
  // Clamp the zoom so the stitched canvas never exceeds MAX_STITCH_SIDE.
  const zoom = getElevationZoom(bbox, width);
  const tiles = getTileCoordsForBbox(bbox, zoom);
  const tileSize = 256;

  const globalXMin = lngToPixelX(xmin, zoom, tileSize);
  const globalXMax = lngToPixelX(xmax, zoom, tileSize);
  const globalYMin = latToPixelY(ymax, zoom, tileSize);
  const globalYMax = latToPixelY(ymin, zoom, tileSize);
  const globalW = globalXMax - globalXMin;
  const globalH = globalYMax - globalYMin;

  const stitchW = Math.min(Math.ceil(globalW), MAX_STITCH_SIDE);
  const stitchH = Math.min(Math.ceil(globalH), MAX_STITCH_SIDE);
  const stitchCanvas = new OffscreenCanvas(stitchW, stitchH);
  const stitchCtx = stitchCanvas.getContext('2d');
  stitchCtx.imageSmoothingEnabled = false;

  const tilePromises = tiles.map(async ({ x, y, z }) => {
    const url = `${OPEN_TOPO_TILE_URL}/${z}/${x}/${y}.png`;
    try {
      const resp = await fetch(url);
      if (!resp.ok) return null;
      const blob = await resp.blob();
      const bitmap = await createImageBitmap(blob);
      return { bitmap, x, y };
    } catch {
      return null;
    }
  });

  const loadedTiles = (await Promise.all(tilePromises)).filter(Boolean);
  for (const { bitmap, x, y } of loadedTiles) {
    const drawX = x * tileSize - globalXMin;
    const drawY = y * tileSize - globalYMin;
    stitchCtx.drawImage(bitmap, drawX, drawY);
  }

  const resampleCanvas = new OffscreenCanvas(width, height);
  const resampleCtx = resampleCanvas.getContext('2d');
  resampleCtx.imageSmoothingEnabled = false;
  resampleCtx.drawImage(stitchCanvas, 0, 0, width, height);

  const imageData = resampleCtx.getImageData(0, 0, width, height);
  const pixels = imageData.data;
  const values = new Float32Array(width * height);
  const validMask = new Uint8Array(width * height);

  for (let i = 0; i < width * height; i++) {
    const a = pixels[i * 4 + 3];
    if (a === 0) {
      values[i] = 0;
      continue;
    }
    const r = pixels[i * 4];
    const g = pixels[i * 4 + 1];
    const b = pixels[i * 4 + 2];
    values[i] = (r * 256 + g + b / 256) - 32768;
    validMask[i] = 1;
  }

  return finalizeElevationData(values, validMask, width, height, bbox);
}

function finalizeElevationData(values, validMask, width, height, bbox) {
  let min = Infinity;
  let max = -Infinity;

  for (let i = 0; i < values.length; i++) {
    if (!validMask[i]) continue;
    const v = values[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    values.fill(0);
    return { values, width, height, min: 0, max: 0, bbox };
  }

  fillNoDataWithNeighbors(values, validMask, width, height);

  min = Infinity;
  max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }

  return { values, width, height, min, max, bbox };
}

function bboxOverlapsUS(bbox) {
  const [xmin, ymin, xmax, ymax] = bbox;
  const usWest = -170;
  const usEast = -60;
  const usSouth = 15;
  const usNorth = 72;
  return xmax >= usWest && xmin <= usEast && ymax >= usSouth && ymin <= usNorth;
}

function fillNoDataWithNeighbors(values, validMask, width, height) {
  const nextValues = new Float32Array(values.length);
  const nextValid = new Uint8Array(values.length);

  for (let i = 0; i < values.length; i++) {
    nextValues[i] = values[i];
    nextValid[i] = validMask[i];
  }

  const maxIterations = Math.max(width, height);
  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = 0;

    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const idx = row * width + col;
        if (nextValid[idx]) continue;

        let sum = 0;
        let count = 0;

        if (row > 0) {
          const n = idx - width;
          if (nextValid[n]) {
            sum += nextValues[n];
            count++;
          }
        }
        if (row < height - 1) {
          const n = idx + width;
          if (nextValid[n]) {
            sum += nextValues[n];
            count++;
          }
        }
        if (col > 0) {
          const n = idx - 1;
          if (nextValid[n]) {
            sum += nextValues[n];
            count++;
          }
        }
        if (col < width - 1) {
          const n = idx + 1;
          if (nextValid[n]) {
            sum += nextValues[n];
            count++;
          }
        }

        if (count > 0) {
          values[idx] = sum / count;
          validMask[idx] = 1;
          changed++;
        }
      }
    }

    if (changed === 0) break;

    for (let i = 0; i < values.length; i++) {
      nextValues[i] = values[i];
      nextValid[i] = validMask[i];
    }
  }

  let fallback = 0;
  for (let i = 0; i < values.length; i++) {
    if (validMask[i]) {
      fallback = values[i];
      break;
    }
  }
  for (let i = 0; i < values.length; i++) {
    if (!validMask[i]) values[i] = fallback;
  }
}

function lngToPixelX(lng, zoom, tileSize) {
  return ((lng + 180) / 360) * Math.pow(2, zoom) * tileSize;
}

function latToPixelY(lat, zoom, tileSize) {
  const latRad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * Math.pow(2, zoom) * tileSize;
}

function lngToTileX(lng, zoom) {
  return Math.floor(((lng + 180) / 360) * Math.pow(2, zoom));
}

function latToTileY(lat, zoom) {
  const latRad = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * Math.pow(2, zoom));
}

function getElevationZoom(bbox, targetPixels) {
  const [xmin, , xmax] = bbox;
  const lngSpan = xmax - xmin;
  const z = Math.round(Math.log2((targetPixels * 360) / (lngSpan * 256)));
  // Terrarium max zoom is 15. Also cap by stitched-canvas size so we never
  // try to allocate a canvas larger than MAX_STITCH_SIDE on either axis.
  const maxZoomByCanvas = Math.floor(Math.log2(MAX_STITCH_SIDE / 256));
  return Math.max(3, Math.min(15, maxZoomByCanvas, z));
}

function getTileCoordsForBbox(bbox, zoom) {
  const [xmin, ymin, xmax, ymax] = bbox;
  const x0 = lngToTileX(xmin, zoom);
  const x1 = lngToTileX(xmax, zoom);
  const y0 = latToTileY(ymax, zoom);
  const y1 = latToTileY(ymin, zoom);

  const tiles = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      tiles.push({ x, y, z: zoom });
    }
  }
  return tiles;
}
