// Map raw ESRI LULC class values to RGB colors on a canvas

export function applyColormap(imageBitmap, colormap, width, height) {
  // Use regular canvas (OffscreenCanvas doesn't work with THREE.CanvasTexture)
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imageBitmap, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  const pixels = imageData.data;

  // Build lookup from class value to RGB
  const lookup = {};
  for (const [classVal, info] of Object.entries(colormap)) {
    const hex = info.color;
    lookup[parseInt(classVal)] = hexToRgb(hex);
  }

  // The raw export uses the red channel as class value for single-band data
  const outData = ctx.createImageData(width, height);
  const out = outData.data;

  for (let i = 0; i < width * height; i++) {
    const classVal = pixels[i * 4]; // R channel = class value
    const rgb = lookup[classVal];
    if (rgb) {
      out[i * 4] = rgb.r;
      out[i * 4 + 1] = rgb.g;
      out[i * 4 + 2] = rgb.b;
      out[i * 4 + 3] = 255;
    } else {
      // Unknown class — neutral light gray
      out[i * 4] = 200;
      out[i * 4 + 1] = 200;
      out[i * 4 + 2] = 200;
      out[i * 4 + 3] = 255;
    }
  }

  ctx.putImageData(outData, 0, 0);
  return canvas;
}

export function bitmapToCanvas(imageBitmap, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imageBitmap, 0, 0, width, height);
  return canvas;
}

/**
 * Masks a canvas so only pixels inside the GeoJSON polygon are visible.
 * Pixels outside are set to white.
 * @param {HTMLCanvasElement} canvas - The texture canvas to mask
 * @param {Object} geojson - GeoJSON geometry (Polygon, MultiPolygon, or GeometryCollection)
 * @param {number[]} bbox - [xmin, ymin, xmax, ymax] = [west, south, east, north]
 */
export function maskCanvasWithPolygon(canvas, geojson, bbox) {
  const { width, height } = canvas;
  const [xmin, ymin, xmax, ymax] = bbox;

  // Create a mask canvas — draw the polygon filled white on black
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = width;
  maskCanvas.height = height;
  const maskCtx = maskCanvas.getContext('2d');

  // Start with all black (outside)
  maskCtx.fillStyle = '#000';
  maskCtx.fillRect(0, 0, width, height);

  // Draw polygon(s) in white (inside)
  maskCtx.fillStyle = '#fff';
  maskCtx.beginPath();

  const rings = extractRings(geojson);
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const [lng, lat] = ring[i];
      // Convert geo coords to pixel coords
      const px = ((lng - xmin) / (xmax - xmin)) * width;
      // Canvas Y is top-down, lat increases upward
      const py = ((ymax - lat) / (ymax - ymin)) * height;
      if (i === 0) maskCtx.moveTo(px, py);
      else maskCtx.lineTo(px, py);
    }
    maskCtx.closePath();
  }
  maskCtx.fill();

  // Read mask and apply to original canvas
  const maskData = maskCtx.getImageData(0, 0, width, height).data;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, width, height);
  const pixels = imageData.data;

  for (let i = 0; i < width * height; i++) {
    const maskVal = maskData[i * 4]; // R channel of mask (0=outside, 255=inside)
    if (maskVal < 128) {
      // Outside polygon — set to transparent
      pixels[i * 4] = 0;
      pixels[i * 4 + 1] = 0;
      pixels[i * 4 + 2] = 0;
      pixels[i * 4 + 3] = 0;
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

/**
 * Extract coordinate rings from a GeoJSON geometry
 */
function extractRings(geojson) {
  const rings = [];

  if (geojson.type === 'Polygon') {
    // First ring is the outer boundary
    if (geojson.coordinates && geojson.coordinates[0]) {
      rings.push(geojson.coordinates[0]);
    }
  } else if (geojson.type === 'MultiPolygon') {
    for (const poly of geojson.coordinates) {
      if (poly[0]) rings.push(poly[0]);
    }
  } else if (geojson.type === 'GeometryCollection' && geojson.geometries) {
    for (const g of geojson.geometries) {
      rings.push(...extractRings(g));
    }
  }

  return rings;
}

function hexToRgb(hex) {
  hex = hex.replace('#', '');
  return {
    r: parseInt(hex.substring(0, 2), 16),
    g: parseInt(hex.substring(2, 4), 16),
    b: parseInt(hex.substring(4, 6), 16),
  };
}
