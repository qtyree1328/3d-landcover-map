// Generic tile-based raster fetcher for OSM, ESRI World Imagery, etc.
const MAX_STITCH_SIDE = 8192;

export async function fetchOSMTiles(bbox, width, height) {
  return fetchTileLayer(bbox, width, height, (x, y, z) =>
    `https://tile.openstreetmap.org/${z}/${x}/${y}.png`
  );
}

export async function fetchESRIWorldImagery(bbox, width, height) {
  return fetchTileLayer(bbox, width, height, (x, y, z) =>
    `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`
  );
}

export async function fetchGoogleSatellite(bbox, width, height) {
  return fetchTileLayer(bbox, width, height, (x, y, z) =>
    `https://mt1.google.com/vt/lyrs=s&x=${x}&y=${y}&z=${z}`
  );
}

async function fetchTileLayer(bbox, width, height, urlFn) {
  const [xmin, ymin, xmax, ymax] = bbox;
  const zoom = getZoomForBbox(bbox, width);
  const tiles = getTileCoordsForBbox(bbox, zoom);

  const tileSize = 256;

  const xMinFrac = lngToTileX(xmin, zoom);
  const xMaxFrac = lngToTileX(xmax, zoom);
  const yMinFrac = latToTileY(ymax, zoom);
  const yMaxFrac = latToTileY(ymin, zoom);

  const x0 = Math.floor(xMinFrac);
  const y0 = Math.floor(yMinFrac);
  const numTilesX = Math.floor(xMaxFrac) - x0 + 1;
  const numTilesY = Math.floor(yMaxFrac) - y0 + 1;

  const stitchW = numTilesX * tileSize;
  const stitchH = numTilesY * tileSize;
  const stitchCanvas = document.createElement('canvas');
  stitchCanvas.width = stitchW;
  stitchCanvas.height = stitchH;
  const stitchCtx = stitchCanvas.getContext('2d');

  const tilePromises = tiles.map(async ({ x, y, z }) => {
    const url = urlFn(x, y, z);
    try {
      const resp = await fetch(url);
      if (!resp.ok) return null;
      const blob = await resp.blob();
      return { bitmap: await createImageBitmap(blob), x, y };
    } catch {
      return null;
    }
  });

  const loadedTiles = (await Promise.all(tilePromises)).filter(Boolean);

  for (const { bitmap, x, y } of loadedTiles) {
    const drawX = (x - x0) * tileSize;
    const drawY = (y - y0) * tileSize;
    stitchCtx.drawImage(bitmap, drawX, drawY);
  }

  const cropX = (xMinFrac - x0) * tileSize;
  const cropY = (yMinFrac - y0) * tileSize;
  const cropW = (xMaxFrac - xMinFrac) * tileSize;
  const cropH = (yMaxFrac - yMinFrac) * tileSize;

  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = width;
  outputCanvas.height = height;
  const outputCtx = outputCanvas.getContext('2d');
  outputCtx.drawImage(stitchCanvas, cropX, cropY, cropW, cropH, 0, 0, width, height);

  const bitmap = await createImageBitmap(outputCanvas);
  return { bitmap, isRawClassValues: false };
}

function lngToTileX(lng, zoom) {
  return ((lng + 180) / 360) * Math.pow(2, zoom);
}

function latToTileY(lat, zoom) {
  const latRad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * Math.pow(2, zoom);
}

function getZoomForBbox(bbox, targetPixels) {
  const [xmin, , xmax] = bbox;
  const lngSpan = xmax - xmin;
  const z = Math.round(Math.log2((targetPixels * 360) / (lngSpan * 256)));
  // Cap zoom so the stitched tile canvas stays within GPU/canvas limits.
  const maxZoomByCanvas = Math.floor(Math.log2(MAX_STITCH_SIDE / 256));
  return Math.max(3, Math.min(19, maxZoomByCanvas, z));
}

function getTileCoordsForBbox(bbox, zoom) {
  const [xmin, ymin, xmax, ymax] = bbox;
  const x0 = Math.floor(lngToTileX(xmin, zoom));
  const x1 = Math.floor(lngToTileX(xmax, zoom));
  const y0 = Math.floor(latToTileY(ymax, zoom));
  const y1 = Math.floor(latToTileY(ymin, zoom));

  const tiles = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      tiles.push({ x, y, z: zoom });
    }
  }
  return tiles;
}
