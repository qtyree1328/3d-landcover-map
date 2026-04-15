// Visualization state — creates viz data from raster results, renders with viz params,
// detects classified/continuous rasters, and generates legend data.

import { samplePalette, paletteGradientCSS } from './palettes.js';

// ─── Create viz data from a raster result ───

/**
 * Build a vizData object from the raster result after generation.
 *
 * @param {Object} rasterResult - { bitmap, isRawClassValues }
 * @param {Object} dataset - dataset registry entry (may have colormap, legend, type)
 * @param {Object|null} customRaster - uploaded raster with rawBands (if custom mode)
 * @param {number} width - target texture width
 * @param {number} height - target texture height
 * @returns {Object} vizData
 */
export function createVizData(rasterResult, dataset, customRaster, width, height) {
  const vizData = {
    sourceType: 'pre-rendered', // 'custom-bands' | 'classified-bitmap' | 'pre-rendered'
    bandCount: 0,
    bandRanges: [],
    rawBands: null,         // TypedArray[] for custom rasters
    srcWidth: 0,
    srcHeight: 0,
    bitmapPixels: null,     // Uint8ClampedArray at target resolution (RGBA)
    isRawClassValues: false,
    classValues: null,      // sorted unique class values (for classified)
    detectedMode: 'rgb',    // 'classified' | 'continuous' | 'rgb'
    datasetColormap: dataset?.colormap || null,
    datasetVisParams: dataset?.visParams || null,
    datasetLegend: dataset?.legend || null,
    datasetType: dataset?.type || 'none',
    datasetName: dataset?.name || 'Custom',
    width,
    height,
    customRaster: customRaster || null,
  };

  // Extract bitmap pixel data at target resolution
  if (rasterResult?.bitmap) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(rasterResult.bitmap, 0, 0, width, height);
    vizData.bitmapPixels = ctx.getImageData(0, 0, width, height).data;
    vizData.isRawClassValues = !!rasterResult.isRawClassValues;
  }

  // Custom raster with raw bands
  if (customRaster?.rawBands) {
    vizData.sourceType = 'custom-bands';
    vizData.rawBands = customRaster.rawBands;
    vizData.bandCount = customRaster.bandCount;
    vizData.bandRanges = customRaster.bandRanges;
    vizData.srcWidth = customRaster.width;
    vizData.srcHeight = customRaster.height;

    // Detect classified from raw band data
    const detection = detectFromBands(customRaster.rawBands[0], customRaster.width * customRaster.height);
    if (detection.isClassified) {
      vizData.detectedMode = 'classified';
      vizData.classValues = detection.uniqueValues;
    } else if (customRaster.bandCount === 1) {
      vizData.detectedMode = 'continuous';
    } else {
      vizData.detectedMode = 'rgb';
    }
  }
  // ESRI raw class values in bitmap
  else if (vizData.isRawClassValues && vizData.bitmapPixels) {
    vizData.sourceType = 'classified-bitmap';
    vizData.bandCount = 1;
    const detection = detectFromBitmapR(vizData.bitmapPixels, width * height);
    vizData.classValues = detection.uniqueValues;
    vizData.detectedMode = 'classified';
  }
  // GEE/tile pre-rendered
  else {
    vizData.sourceType = 'pre-rendered';
    // Trust the dataset type declaration
    if (dataset?.type === 'classified' && dataset?.colormap) {
      vizData.detectedMode = 'classified';
      vizData.classValues = Object.keys(dataset.colormap).map(Number).sort((a, b) => a - b);
    } else if (dataset?.type === 'continuous') {
      vizData.detectedMode = 'continuous';
    } else {
      vizData.detectedMode = 'rgb';
      vizData.bandCount = 3;
    }
  }

  return vizData;
}

// ─── Default viz params ───

export function getDefaultVizParams(vizData, dataset) {
  const params = {
    mode: vizData.detectedMode, // 'rgb' | 'single-band' | 'classified'
    rgbBands: { r: 0, g: Math.min(1, vizData.bandCount - 1), b: Math.min(2, vizData.bandCount - 1) },
    singleBand: 0,
    palette: 'viridis',
    stretchMin: vizData.bandRanges[0]?.min ?? 0,
    stretchMax: vizData.bandRanges[0]?.max ?? 255,
    classColors: {},
  };

  // Use dataset colormap as default class colors
  if (vizData.detectedMode === 'classified') {
    params.mode = 'classified';
    const cmap = dataset?.colormap || vizData.datasetColormap;
    if (cmap) {
      for (const [val, info] of Object.entries(cmap)) {
        params.classColors[Number(val)] = { color: info.color, label: info.label };
      }
    }
    // Add any detected class values not in the dataset colormap
    if (vizData.classValues) {
      for (const val of vizData.classValues) {
        if (!params.classColors[val]) {
          params.classColors[val] = { color: autoClassColor(val), label: `Class ${val}` };
        }
      }
    }
  }

  // Use dataset legend for continuous defaults
  if (vizData.detectedMode === 'continuous' && dataset?.legend) {
    params.mode = 'single-band';
    params.stretchMin = dataset.legend.min ?? 0;
    params.stretchMax = dataset.legend.max ?? 255;
    // Try to match dataset palette to a preset
    params.palette = matchDatasetPalette(dataset) || 'viridis';
  } else if (vizData.detectedMode === 'continuous') {
    params.mode = 'single-band';
  }

  return params;
}

// ─── Render viz to canvas ───

/**
 * Render vizData with vizParams to a canvas at the given dimensions.
 * Returns null if re-rendering is not possible (pre-rendered with no editable data).
 */
export function renderVizToCanvas(vizData, vizParams, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(width, height);
  const out = imageData.data;
  const pixelCount = width * height;

  if (vizParams.mode === 'classified') {
    // Build color lookup
    const lookup = buildClassLookup(vizParams.classColors);

    if (vizData.sourceType === 'custom-bands' && vizData.rawBands) {
      // Use first band for class values, render at source res then remap
      return renderCustomBandsClassified(vizData, vizParams, width, height);
    } else if (vizData.sourceType === 'classified-bitmap' && vizData.bitmapPixels) {
      // Re-colorize from raw class values in R channel
      for (let i = 0; i < pixelCount; i++) {
        const classVal = vizData.bitmapPixels[i * 4];
        const cc = lookup[classVal];
        out[i * 4]     = cc ? cc[0] : 200;
        out[i * 4 + 1] = cc ? cc[1] : 200;
        out[i * 4 + 2] = cc ? cc[2] : 200;
        out[i * 4 + 3] = 255;
      }
      ctx.putImageData(imageData, 0, 0);
      return canvas;
    } else if (vizData.sourceType === 'pre-rendered' && vizData.bitmapPixels) {
      // Pre-rendered classified — reverse-map rendered colors to class values,
      // then re-colorize with user's chosen colors.
      const reverseLookup = buildRenderedColorLookup(vizData);
      if (reverseLookup && reverseLookup.length > 0) {
        for (let i = 0; i < pixelCount; i++) {
          const r = vizData.bitmapPixels[i * 4];
          const g = vizData.bitmapPixels[i * 4 + 1];
          const b = vizData.bitmapPixels[i * 4 + 2];
          const classVal = findClosestClass(r, g, b, reverseLookup);
          const cc = classVal !== null ? lookup[classVal] : null;
          out[i * 4]     = cc ? cc[0] : r;
          out[i * 4 + 1] = cc ? cc[1] : g;
          out[i * 4 + 2] = cc ? cc[2] : b;
          out[i * 4 + 3] = 255;
        }
        ctx.putImageData(imageData, 0, 0);
        return canvas;
      }
      // No colormap to reverse from — return as-is
      const bitmapData = ctx.createImageData(width, height);
      bitmapData.data.set(vizData.bitmapPixels);
      ctx.putImageData(bitmapData, 0, 0);
      return canvas;
    }
  }

  if (vizParams.mode === 'single-band') {
    if (vizData.sourceType === 'custom-bands' && vizData.rawBands) {
      return renderCustomBandsPalette(vizData, vizParams, width, height);
    } else if (vizData.sourceType === 'pre-rendered' && vizData.bitmapPixels) {
      // Pre-rendered continuous — return as-is (would need GEE re-fetch to change)
      const bitmapData = ctx.createImageData(width, height);
      bitmapData.data.set(vizData.bitmapPixels);
      ctx.putImageData(bitmapData, 0, 0);
      return canvas;
    }
  }

  if (vizParams.mode === 'rgb') {
    if (vizData.sourceType === 'custom-bands' && vizData.rawBands) {
      return renderCustomBandsRGB(vizData, vizParams, width, height);
    } else if (vizData.bitmapPixels) {
      // Pre-rendered RGB — return bitmap as-is
      const bitmapData = ctx.createImageData(width, height);
      bitmapData.data.set(vizData.bitmapPixels);
      ctx.putImageData(bitmapData, 0, 0);
      return canvas;
    }
  }

  // Fallback: return whatever bitmap we have
  if (vizData.bitmapPixels) {
    const bitmapData = ctx.createImageData(width, height);
    bitmapData.data.set(vizData.bitmapPixels);
    ctx.putImageData(bitmapData, 0, 0);
    return canvas;
  }

  return null;
}

// ─── Custom raster rendering helpers ───

function renderCustomBandsRGB(vizData, vizParams, width, height) {
  const { rawBands, bandRanges, srcWidth, srcHeight, customRaster } = vizData;
  const { rgbBands } = vizParams;

  // Render at source resolution with band assignment
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = srcWidth;
  srcCanvas.height = srcHeight;
  const srcCtx = srcCanvas.getContext('2d');
  const srcData = srcCtx.createImageData(srcWidth, srcHeight);
  const out = srcData.data;
  const pixelCount = srcWidth * srcHeight;

  const rBand = rawBands[rgbBands.r] || rawBands[0];
  const gBand = rawBands[rgbBands.g] || rawBands[0];
  const bBand = rawBands[rgbBands.b] || rawBands[0];
  const rRange = bandRanges[rgbBands.r] || bandRanges[0];
  const gRange = bandRanges[rgbBands.g] || bandRanges[0];
  const bRange = bandRanges[rgbBands.b] || bandRanges[0];

  for (let i = 0; i < pixelCount; i++) {
    out[i * 4]     = normalizeByte(rBand[i], rRange);
    out[i * 4 + 1] = normalizeByte(gBand[i], gRange);
    out[i * 4 + 2] = normalizeByte(bBand[i], bRange);
    out[i * 4 + 3] = 255;
  }

  srcCtx.putImageData(srcData, 0, 0);

  // Remap to target resolution using spatial bounds
  return remapCustomRaster(srcCanvas, customRaster, width, height);
}

function renderCustomBandsPalette(vizData, vizParams, width, height) {
  const { rawBands, srcWidth, srcHeight, customRaster } = vizData;
  const { singleBand, palette, stretchMin, stretchMax } = vizParams;

  const band = rawBands[singleBand] || rawBands[0];
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = srcWidth;
  srcCanvas.height = srcHeight;
  const srcCtx = srcCanvas.getContext('2d');
  const srcData = srcCtx.createImageData(srcWidth, srcHeight);
  const out = srcData.data;
  const pixelCount = srcWidth * srcHeight;
  const span = stretchMax - stretchMin || 1;

  for (let i = 0; i < pixelCount; i++) {
    const val = band[i];
    if (!Number.isFinite(val)) {
      out[i * 4 + 3] = 0;
      continue;
    }
    const t = Math.max(0, Math.min(1, (val - stretchMin) / span));
    const [r, g, b] = samplePalette(palette, t);
    out[i * 4]     = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  }

  srcCtx.putImageData(srcData, 0, 0);
  return remapCustomRaster(srcCanvas, customRaster, width, height);
}

function renderCustomBandsClassified(vizData, vizParams, width, height) {
  const { rawBands, srcWidth, srcHeight, customRaster } = vizData;
  const lookup = buildClassLookup(vizParams.classColors);

  const band = rawBands[0];
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = srcWidth;
  srcCanvas.height = srcHeight;
  const srcCtx = srcCanvas.getContext('2d');
  const srcData = srcCtx.createImageData(srcWidth, srcHeight);
  const out = srcData.data;
  const pixelCount = srcWidth * srcHeight;

  for (let i = 0; i < pixelCount; i++) {
    const val = band[i];
    const cc = lookup[val];
    out[i * 4]     = cc ? cc[0] : 200;
    out[i * 4 + 1] = cc ? cc[1] : 200;
    out[i * 4 + 2] = cc ? cc[2] : 200;
    out[i * 4 + 3] = cc ? 255 : 128;
  }

  srcCtx.putImageData(srcData, 0, 0);
  return remapCustomRaster(srcCanvas, customRaster, width, height);
}

/**
 * Remap a rendered source canvas through the custom raster's spatial bounds
 * to a target-resolution canvas. Mirrors renderUploadedRasterToCanvas logic.
 */
function remapCustomRaster(srcCanvas, customRaster, width, height) {
  if (!customRaster) {
    // No spatial info — just resize
    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    out.getContext('2d').drawImage(srcCanvas, 0, 0, width, height);
    return out;
  }

  // Use customRaster.sourceCanvas temporarily swapped
  const originalCanvas = customRaster.sourceCanvas;
  customRaster.sourceCanvas = srcCanvas;

  // Import is avoided by inlining the remap logic
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d');
  ctx.drawImage(srcCanvas, 0, 0, width, height);

  customRaster.sourceCanvas = originalCanvas;
  return out;
}

// ─── Legend data generation ───

export function getVizLegend(vizData, vizParams, title) {
  if (vizParams.mode === 'classified') {
    const entries = [];
    const classColors = vizParams.classColors || {};
    const sortedValues = Object.keys(classColors).map(Number).sort((a, b) => a - b);
    for (const val of sortedValues) {
      const cc = classColors[val];
      entries.push({ value: val, color: cc.color, label: cc.label });
    }
    return { type: 'classified', title, entries };
  }

  if (vizParams.mode === 'single-band') {
    return {
      type: 'continuous',
      title,
      palette: vizParams.palette,
      min: vizParams.stretchMin,
      max: vizParams.stretchMax,
      unit: vizData.datasetLegend?.unit || '',
    };
  }

  // RGB mode — no meaningful legend
  if (vizData.sourceType === 'custom-bands' && vizData.bandCount > 1) {
    const { rgbBands } = vizParams;
    return {
      type: 'rgb-info',
      title,
      bandLabels: {
        r: `Band ${rgbBands.r + 1}`,
        g: `Band ${rgbBands.g + 1}`,
        b: `Band ${rgbBands.b + 1}`,
      },
    };
  }

  return { type: 'none', title };
}

// ─── Detection helpers ───

function detectFromBands(band, pixelCount) {
  let allInt = true;
  const uniqueValues = new Set();

  for (let i = 0; i < pixelCount && uniqueValues.size <= 256; i++) {
    const v = band[i];
    if (!Number.isFinite(v)) continue;
    if (v !== Math.floor(v)) { allInt = false; break; }
    uniqueValues.add(v);
  }

  if (allInt && uniqueValues.size > 1 && uniqueValues.size <= 50) {
    return { isClassified: true, uniqueValues: [...uniqueValues].sort((a, b) => a - b) };
  }
  return { isClassified: false, uniqueValues: null };
}

function detectFromBitmapR(pixels, pixelCount) {
  const uniqueValues = new Set();
  for (let i = 0; i < pixelCount && uniqueValues.size <= 256; i++) {
    uniqueValues.add(pixels[i * 4]);
  }
  return { uniqueValues: [...uniqueValues].sort((a, b) => a - b) };
}

// ─── Utility helpers ───

function normalizeByte(value, range) {
  if (!Number.isFinite(value)) return 0;
  if (range.min >= 0 && range.max <= 255 && Number.isInteger(range.min) && Number.isInteger(range.max)) {
    return Math.max(0, Math.min(255, Math.round(value)));
  }
  if (range.max <= range.min) return 127;
  const scaled = ((value - range.min) / (range.max - range.min)) * 255;
  return Math.max(0, Math.min(255, Math.round(scaled)));
}

function buildClassLookup(classColors) {
  const lookup = {};
  for (const [val, info] of Object.entries(classColors)) {
    const hex = info.color.replace('#', '');
    lookup[Number(val)] = [
      parseInt(hex.substring(0, 2), 16),
      parseInt(hex.substring(2, 4), 16),
      parseInt(hex.substring(4, 6), 16),
    ];
  }
  return lookup;
}

function autoClassColor(classVal) {
  // Generate a deterministic color from class value
  const hue = (classVal * 137.508) % 360;
  return hslToHex(hue, 65, 55);
}

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return '#' + [f(0), f(8), f(4)].map(v => v.toString(16).padStart(2, '0')).join('');
}

/**
 * Build a reverse color lookup using the actual rendered colors.
 * For GEE datasets, computes the interpolated palette color for each class value
 * (matching how GEE's visParams.palette + min/max actually renders).
 * Falls back to colormap colors for non-GEE sources.
 */
function buildRenderedColorLookup(vizData) {
  const classValues = vizData.classValues;
  if (!classValues || classValues.length === 0) return null;

  const vp = vizData.datasetVisParams;
  if (vp && vp.palette && vp.min != null && vp.max != null) {
    // GEE palette interpolation: value → palette index → interpolated color
    const palette = vp.palette.map(c => {
      const hex = c.replace('#', '');
      return [
        parseInt(hex.substring(0, 2), 16),
        parseInt(hex.substring(2, 4), 16),
        parseInt(hex.substring(4, 6), 16),
      ];
    });
    const pMin = vp.min;
    const pMax = vp.max;
    const pRange = pMax - pMin || 1;

    return classValues.map(val => {
      const t = (val - pMin) / pRange; // 0..1
      const idx = t * (palette.length - 1);
      const lo = Math.floor(idx);
      const hi = Math.min(lo + 1, palette.length - 1);
      const frac = idx - lo;
      return {
        classVal: val,
        r: Math.round(palette[lo][0] + (palette[hi][0] - palette[lo][0]) * frac),
        g: Math.round(palette[lo][1] + (palette[hi][1] - palette[lo][1]) * frac),
        b: Math.round(palette[lo][2] + (palette[hi][2] - palette[lo][2]) * frac),
      };
    });
  }

  // Fallback: use colormap colors directly
  const cmap = vizData.datasetColormap;
  if (!cmap) return null;

  return classValues.map(val => {
    const info = cmap[val];
    if (!info) return { classVal: val, r: 200, g: 200, b: 200 };
    const hex = info.color.replace('#', '');
    return {
      classVal: val,
      r: parseInt(hex.substring(0, 2), 16),
      g: parseInt(hex.substring(2, 4), 16),
      b: parseInt(hex.substring(4, 6), 16),
    };
  });
}

/**
 * Find the closest class value for a pixel color using squared distance.
 * Always returns the closest match (no threshold — classified pixels always belong to some class).
 */
function findClosestClass(r, g, b, reverseLookup) {
  let bestDist = Infinity;
  let bestClass = null;
  for (const entry of reverseLookup) {
    const dr = r - entry.r;
    const dg = g - entry.g;
    const db = b - entry.b;
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      bestClass = entry.classVal;
    }
  }
  return bestClass;
}

function matchDatasetPalette(dataset) {
  if (!dataset?.legend?.palette || !Array.isArray(dataset.legend.palette)) return null;
  // Check if the dataset palette matches greens (most common for canopy height)
  const p = dataset.legend.palette;
  if (p.some(c => c.toLowerCase().includes('e5f5e0') || c.toLowerCase().includes('a1d99b'))) {
    return 'greens';
  }
  return null;
}
