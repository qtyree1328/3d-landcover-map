import { fromArrayBuffer } from 'geotiff';

const TIF_NAME_RE = /\.tiff?$/i;

export async function loadUploadedRaster(file) {
  if (!file) {
    throw new Error('No raster file selected.');
  }

  if (isGeoTiffFile(file)) {
    return loadGeoTiffRaster(file);
  }

  return loadStandardImageRaster(file);
}

export async function renderUploadedRasterToBitmap(uploadedRaster, targetBbox, width, height) {
  const canvas = renderUploadedRasterToCanvas(uploadedRaster, targetBbox, width, height);
  return createImageBitmap(canvas);
}

function isGeoTiffFile(file) {
  const name = (file.name || '').toLowerCase();
  const type = (file.type || '').toLowerCase();
  return TIF_NAME_RE.test(name) || type.includes('tiff') || type.includes('geotiff');
}

async function loadStandardImageRaster(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  if (bitmap.close) bitmap.close();

  // Extract RGBA channels as separate band arrays
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixelCount = canvas.width * canvas.height;
  const rBand = new Uint8Array(pixelCount);
  const gBand = new Uint8Array(pixelCount);
  const bBand = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    rBand[i] = imgData.data[i * 4];
    gBand[i] = imgData.data[i * 4 + 1];
    bBand[i] = imgData.data[i * 4 + 2];
  }

  return {
    name: file.name || 'uploaded-image',
    width: canvas.width,
    height: canvas.height,
    sourceCanvas: canvas,
    bounds: null,
    hasGeoreference: false,
    rawBands: [rBand, gBand, bBand],
    bandCount: 3,
    bandRanges: [{ min: 0, max: 255 }, { min: 0, max: 255 }, { min: 0, max: 255 }],
  };
}

async function loadGeoTiffRaster(file) {
  const buffer = await file.arrayBuffer();
  const tiff = await fromArrayBuffer(buffer);
  const image = await tiff.getImage();

  const width = image.getWidth();
  const height = image.getHeight();
  const bandCount = getSampleCount(image);

  // Read all bands non-interleaved (separate TypedArray per band)
  const rasters = await image.readRasters();
  const rawBands = [];
  for (let b = 0; b < bandCount; b++) {
    rawBands.push(rasters[b]);
  }

  // Compute per-band value ranges
  const bandRanges = rawBands.map(band => {
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < band.length; i++) {
      const v = band[i];
      if (!Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (!Number.isFinite(min)) { min = 0; max = 255; }
    return { min, max };
  });

  // Render default sourceCanvas (first 3 bands as RGB, or grayscale for single band)
  const useSampleCount = Math.min(bandCount, 4);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(width, height);
  fillImageDataFromBands(imageData.data, rawBands, bandRanges, width * height, useSampleCount);
  ctx.putImageData(imageData, 0, 0);

  return {
    name: file.name || 'uploaded-geotiff',
    width,
    height,
    sourceCanvas: canvas,
    bounds: extractBoundsFromGeoTiff(image),
    hasGeoreference: true,
    rawBands,
    bandCount,
    bandRanges,
  };
}

function getSampleCount(image) {
  if (typeof image.getSamplesPerPixel === 'function') {
    const count = image.getSamplesPerPixel();
    if (Number.isFinite(count) && count > 0) return count;
  }
  const fdCount = image.fileDirectory && image.fileDirectory.SamplesPerPixel;
  if (Number.isFinite(fdCount) && fdCount > 0) return fdCount;
  return 1;
}

/**
 * Fill RGBA ImageData from separate band arrays (non-interleaved).
 */
function fillImageDataFromBands(dest, bands, ranges, pixelCount, sampleCount) {
  for (let i = 0; i < pixelCount; i++) {
    const dstOffset = i * 4;
    let r = 0, g = 0, b = 0, a = 255;

    if (sampleCount >= 3) {
      r = normalizeChannelValue(bands[0][i], ranges[0]);
      g = normalizeChannelValue(bands[1][i], ranges[1]);
      b = normalizeChannelValue(bands[2][i], ranges[2]);
      if (sampleCount >= 4) {
        a = normalizeChannelValue(bands[3][i], ranges[3]);
      }
    } else if (sampleCount === 2) {
      const gray = normalizeChannelValue(bands[0][i], ranges[0]);
      r = gray; g = gray; b = gray;
      a = normalizeChannelValue(bands[1][i], ranges[1]);
    } else {
      const gray = normalizeChannelValue(bands[0][i], ranges[0]);
      r = gray; g = gray; b = gray;
    }

    dest[dstOffset] = r;
    dest[dstOffset + 1] = g;
    dest[dstOffset + 2] = b;
    dest[dstOffset + 3] = a;
  }
}

function normalizeChannelValue(value, range) {
  if (!Number.isFinite(value)) return 0;
  if (range.min >= 0 && range.max <= 255 && Number.isInteger(range.min) && Number.isInteger(range.max)) {
    return clampByte(value);
  }
  if (range.max <= range.min) return 127;
  const scaled = ((value - range.min) / (range.max - range.min)) * 255;
  return clampByte(scaled);
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function extractBoundsFromGeoTiff(image) {
  if (!image || typeof image.getBoundingBox !== 'function') return null;
  try {
    const bbox = image.getBoundingBox();
    if (!Array.isArray(bbox) || bbox.length !== 4) return null;
    const [xmin, ymin, xmax, ymax] = bbox.map(Number);
    if (
      Number.isFinite(xmin) &&
      Number.isFinite(ymin) &&
      Number.isFinite(xmax) &&
      Number.isFinite(ymax) &&
      xmax > xmin &&
      ymax > ymin
    ) {
      return [xmin, ymin, xmax, ymax];
    }
  } catch {
    return null;
  }
  return null;
}

function renderUploadedRasterToCanvas(uploadedRaster, targetBbox, width, height) {
  if (!uploadedRaster || !uploadedRaster.sourceCanvas) {
    throw new Error('No uploaded raster loaded.');
  }
  if (!Array.isArray(targetBbox) || targetBbox.length !== 4) {
    throw new Error('Invalid output bbox for custom raster rendering.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);

  const srcCanvas = uploadedRaster.sourceCanvas;
  const srcBounds = uploadedRaster.bounds;

  if (!Array.isArray(srcBounds) || srcBounds.length !== 4) {
    ctx.drawImage(srcCanvas, 0, 0, width, height);
    return canvas;
  }

  const intersection = intersectBbox(targetBbox, srcBounds);
  if (!intersection) {
    throw new Error('Target bounds do not overlap uploaded raster bounds.');
  }

  const [tMinX, tMinY, tMaxX, tMaxY] = targetBbox;
  const [sMinX, sMinY, sMaxX, sMaxY] = srcBounds;
  const [iMinX, iMinY, iMaxX, iMaxY] = intersection;

  const srcW = srcCanvas.width;
  const srcH = srcCanvas.height;
  const targetRangeX = tMaxX - tMinX;
  const targetRangeY = tMaxY - tMinY;
  const sourceRangeX = sMaxX - sMinX;
  const sourceRangeY = sMaxY - sMinY;

  if (targetRangeX <= 0 || targetRangeY <= 0 || sourceRangeX <= 0 || sourceRangeY <= 0) {
    throw new Error('Invalid bbox extents for custom raster rendering.');
  }

  const sx = ((iMinX - sMinX) / sourceRangeX) * srcW;
  const sy = ((sMaxY - iMaxY) / sourceRangeY) * srcH;
  const sw = ((iMaxX - iMinX) / sourceRangeX) * srcW;
  const sh = ((iMaxY - iMinY) / sourceRangeY) * srcH;

  const dx = ((iMinX - tMinX) / targetRangeX) * width;
  const dy = ((tMaxY - iMaxY) / targetRangeY) * height;
  const dw = ((iMaxX - iMinX) / targetRangeX) * width;
  const dh = ((iMaxY - iMinY) / targetRangeY) * height;

  ctx.drawImage(srcCanvas, sx, sy, sw, sh, dx, dy, dw, dh);
  return canvas;
}

function intersectBbox(a, b) {
  const xmin = Math.max(a[0], b[0]);
  const ymin = Math.max(a[1], b[1]);
  const xmax = Math.min(a[2], b[2]);
  const ymax = Math.min(a[3], b[3]);
  if (!(xmax > xmin && ymax > ymin)) return null;
  return [xmin, ymin, xmax, ymax];
}
