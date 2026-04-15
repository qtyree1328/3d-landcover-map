import * as THREE from 'three';
import { setupCamera, setupControls } from './scene/camera.js';
import { setupLighting } from './scene/lighting.js';
import { createShadowFloor } from './scene/shadow.js';
import { buildTerrainMesh, updateTerrainZScale, updateShadowOffset, updateShadowAnchor } from './scene/terrain.js';
import { setupRasterizerRenderer } from './renderers/rasterizer.js';
import { setupPathTracerRenderer } from './renderers/pathtracer.js';
import { fetchElevation } from './data/elevation.js';
import { fetchESRILulc, fetchESRITiles } from './data/esri.js';
import { fetchOSMTiles, fetchESRIWorldImagery, fetchGoogleSatellite } from './data/tiles.js';
import { getDataset } from './data/datasets.js';
import { getSatelliteDataset } from './data/satellite.js';
import { PALETTES } from './viz/palettes.js';
import { applyColormap, bitmapToCanvas, maskCanvasWithPolygon } from './utils/colormap.js';
import { canvasToTexture } from './utils/texture.js';
import { bboxAspectRatio } from './utils/geom.js';
import { initControls } from './ui/controls.js';
import { initVizControls, populateVizControls } from './ui/viz-controls.js';
import { updateLegend } from './ui/legend.js';
import { showLoading, hideLoading, updateTitle, updateSampleCounter } from './ui/overlay.js';
import { createVizData, getDefaultVizParams, renderVizToCanvas, getVizLegend } from './viz/viz-state.js';
import { initVectorPanel, setVectorBbox, getVisibleLayers, getVectorOffset } from './ui/vector-panel.js';

// App state
let scene, camera, controls, canvas;
let activeRenderer = null;
let rasterizerRenderer = null;
let pathtracerRenderer = null;
let terrainGroup = null;
let shadowFloor = null;
let currentElevationData = null;
let currentBaseDepth = 0.15;
let renderMode = 'rasterizer';
let animationId = null;

// Leaflet map state
let leafletMap = null;
let bboxRect = null;
let boundaryLayer = null;

// Polygon boundary for texture masking
let currentBoundaryGeoJSON = null;

// Viz state for re-rendering without re-fetching
let currentVizData = null;
let currentVizParams = null;
let currentTextureWidth = 0;
let currentTextureHeight = 0;
let currentBbox = null;
let currentUseBoundaryMask = false;
let currentDataset = null;
let currentTitle = '';

// Camera presets (position vectors)
const CAMERA_PRESETS = {
  oblique: { pos: [0.8, 0.9, 1.2], target: [0, 0, 0] },
  top:     { pos: [0, 2.0, 0.001], target: [0, 0, 0] },
  front:   { pos: [0, 0.3, 1.6], target: [0, 0, 0] },
  side:    { pos: [1.6, 0.3, 0], target: [0, 0, 0] },
};

function init() {
  const viewport = document.getElementById('viewport');

  // Create canvas
  canvas = document.createElement('canvas');
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  viewport.appendChild(canvas);

  // Scene with white background
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);

  // Camera
  camera = setupCamera(viewport);

  // Set up rasterizer renderer (default)
  rasterizerRenderer = setupRasterizerRenderer(canvas, scene, camera);
  activeRenderer = rasterizerRenderer;

  // Controls
  controls = setupControls(camera, canvas, () => {
    if (activeRenderer && activeRenderer.type === 'pathtracer' && activeRenderer.reset) {
      activeRenderer.reset();
    }
  });

  // Lighting
  setupLighting(scene);

  // Shadow floor
  shadowFloor = createShadowFloor();
  scene.add(shadowFloor);

  // Initialize Leaflet map preview
  initMapPreview();

  // Init viz controls
  initVizControls({ onApplyViz: handleApplyViz });

  // Init vector overlay panel
  initVectorPanel({ onApplyVectors: handleApplyVectors });

  // Init UI controls
  initControls({
    onGenerate: handleGenerate,
    onZScaleChange: handleZScaleChange,
    onBaseDepthChange: handleBaseDepthChange,
    onYPositionChange: handleYPositionChange,
    onRenderModeChange: handleRenderModeChange,
    onExport: handleExport,
    onCameraPreset: handleCameraPreset,
    onToggleTitle: handleToggleTitle,
    onToggleLegend: handleToggleLegend,
    onLocationSelected: handleLocationSelected,
    onShadowOffsetChange: handleShadowOffsetChange,
  });

  // Make legend draggable
  initLegendDrag();

  // Handle resize
  window.addEventListener('resize', handleResize);

  // Ensure renderer has proper dimensions after layout
  requestAnimationFrame(handleResize);

  // Start render loop
  animate();
}

function initMapPreview() {
  const mapEl = document.getElementById('map-preview');
  if (!mapEl) return; // Map preview may not exist yet if API path is hidden

  leafletMap = L.map(mapEl, {
    center: [20, 0],
    zoom: 2,
    zoomControl: true,
    attributionControl: false,
  });

  // Dark-themed tile layer to match the panel
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
  }).addTo(leafletMap);

  // Fix Leaflet rendering in hidden/flex containers
  setTimeout(() => leafletMap.invalidateSize(), 200);
}

function handleLocationSelected(bbox, displayName, geojsonBounds) {
  // Store boundary for texture masking
  currentBoundaryGeoJSON = geojsonBounds || null;

  // Update vector panel bbox for OSM queries
  setVectorBbox(bbox);

  // Lazy-init API path map if needed
  if (!leafletMap) {
    initMapPreview();
  }
  if (!leafletMap) return;

  // Invalidate map size in case step was just opened
  leafletMap.invalidateSize();

  // bbox is [xmin, ymin, xmax, ymax] = [west, south, east, north]
  const [west, south, east, north] = bbox;
  const bounds = L.latLngBounds(
    L.latLng(south, west),
    L.latLng(north, east)
  );

  // Remove old layers
  if (bboxRect) leafletMap.removeLayer(bboxRect);
  if (boundaryLayer) leafletMap.removeLayer(boundaryLayer);

  if (geojsonBounds) {
    // Show the actual polygon boundary from Nominatim/Overpass/OSM.fr
    boundaryLayer = L.geoJSON(geojsonBounds, {
      style: {
        color: '#818cf8',
        weight: 2,
        fillColor: '#6366f1',
        fillOpacity: 0.15,
      },
    }).addTo(leafletMap);

    // Also show the derived bbox as a dashed rectangle
    bboxRect = L.rectangle(bounds, {
      color: '#f59e0b',
      weight: 1,
      dashArray: '5,5',
      fillOpacity: 0,
    }).addTo(leafletMap);

    if (boundaryLayer.getBounds().isValid()) {
      leafletMap.fitBounds(boundaryLayer.getBounds(), { padding: [15, 15] });
    }
  } else {
    // Just show bbox rectangle
    bboxRect = L.rectangle(bounds, {
      color: '#818cf8',
      weight: 2,
      fillColor: '#6366f1',
      fillOpacity: 0.15,
    }).addTo(leafletMap);

    leafletMap.fitBounds(bounds, { padding: [15, 15] });
  }
}

function animate() {
  animationId = requestAnimationFrame(animate);
  controls.update();

  if (activeRenderer) {
    if (activeRenderer.type === 'pathtracer') {
      const samples = activeRenderer.render();
      updateSampleCounter(samples, true);
    } else {
      activeRenderer.render();
      updateSampleCounter(0, false);
    }
  }
}

async function handleGenerate({
  mode = 'annual',
  bbox,
  datasetId,
  year,
  satelliteDatasetId,
  satelliteSceneId,
  satelliteSceneDate,
  satelliteAnchorDate,
  satelliteWindowStart,
  satelliteWindowEnd,
  satelliteMaxCloudCover = null,
  satelliteDateRangeDays = 90,
  satelliteVisMode = 'rgb',
  satelliteRgbBands = null,
  satelliteRgbColors = null,
  satelliteNdviPalette = null,
  customRaster = null,
  useBoundaryMask = true,
  zScale,
  demMode = 'auto',
}) {
  showLoading('Fetching elevation data...');

  try {
    const dataset = mode === 'satellite'
      ? getSatelliteDataset(satelliteDatasetId)
      : mode === 'custom'
        ? {
          id: 'custom-raster',
          name: customRaster ? `Custom Raster (${customRaster.name || 'upload'})` : 'Custom Raster',
          source: 'custom-upload',
          type: 'none',
        }
        : getDataset(datasetId);
    if (!dataset) {
      throw new Error(
        mode === 'satellite'
          ? `Unknown satellite dataset: ${satelliteDatasetId}`
          : `Unknown dataset: ${datasetId}`
      );
    }

    const selectedYear = Number.isFinite(year) ? year : null;
    const rasterOptions = {};
    if (mode === 'satellite') {
      const visMode = satelliteVisMode === 'ndvi' ? 'ndvi' : 'rgb';
      let visParams = dataset.visualizations && dataset.visualizations[visMode]
        ? { ...dataset.visualizations[visMode] }
        : (dataset.visualizations ? { ...dataset.visualizations.rgb } : null);
      if (!visParams) {
        throw new Error(`Missing visualization parameters for mode "${visMode}"`);
      }

      // Override bands with user selection for RGB mode
      if (visMode === 'rgb' && satelliteRgbBands && satelliteRgbBands.length === 3) {
        visParams = { ...visParams, bands: satelliteRgbBands };
      }

      // Override palette with user selection for NDVI mode
      if (visMode === 'ndvi' && satelliteNdviPalette && PALETTES[satelliteNdviPalette]) {
        visParams = {
          ...visParams,
          palette: PALETTES[satelliteNdviPalette].map(c => c.replace('#', '')),
        };
      }

      const anchorDate = satelliteAnchorDate || null;
      if (!anchorDate) {
        throw new Error('Missing satellite anchor date for composite generation.');
      }
      rasterOptions.assetId = dataset.collectionId;
      rasterOptions.assetType = 'collection';
      rasterOptions.visParams = visParams;
      rasterOptions.satelliteRgbColors = (visMode === 'rgb' && satelliteRgbColors) ? satelliteRgbColors : null;
      rasterOptions.composite = {
        strategy: dataset.compositeStrategy,
        anchorDate,
        dateRangeDays: satelliteDateRangeDays,
        startDate: satelliteWindowStart || null,
        endDate: satelliteWindowEnd || null,
        visMode,
        cloudProperty: dataset.cloudProperty || null,
        maxCloudCover: satelliteMaxCloudCover,
        ndviBands: visMode === 'ndvi' ? (dataset.ndviBands || null) : null,
      };
    } else if (mode === 'custom') {
      if (!customRaster) {
        throw new Error('No custom raster uploaded.');
      }
      rasterOptions.customRaster = customRaster;
    }

    // Auto-determine resolution based on source type
    const aspect = bboxAspectRatio(bbox);
    const resolution = getAutoResolution(mode, dataset, customRaster);
    let width, height;
    if (aspect >= 1) {
      width = resolution;
      height = Math.round(resolution / aspect);
    } else {
      height = resolution;
      width = Math.round(resolution * aspect);
    }

    // Fetch elevation and raster in parallel
    showLoading('Fetching elevation & land cover data...');

    const [elevationData, rasterResult] = await Promise.all([
      fetchElevation(bbox, width, height, { mode: demMode }),
      fetchRaster(dataset, bbox, width, height, selectedYear, rasterOptions),
    ]);

    currentElevationData = elevationData;

    showLoading('Building 3D terrain...');

    // Store state for re-rendering
    currentTextureWidth = width;
    currentTextureHeight = height;
    currentBbox = bbox;
    setVectorBbox(bbox); // Keep vector panel bbox in sync with terrain
    currentUseBoundaryMask = useBoundaryMask;
    currentDataset = dataset;

    // Build viz data and default params
    const customRasterObj = mode === 'custom' ? customRaster : null;
    currentVizData = createVizData(rasterResult, dataset, customRasterObj, width, height);
    currentVizParams = getDefaultVizParams(currentVizData, dataset);

    // Create texture from viz state
    let textureCanvas;
    if (rasterResult.isRawClassValues && dataset.colormap) {
      // Use viz-state rendering for classified (honors default class colors)
      textureCanvas = renderVizToCanvas(currentVizData, currentVizParams, width, height);
    }
    if (!textureCanvas) {
      if (rasterResult.isRawClassValues && dataset.colormap) {
        textureCanvas = applyColormap(rasterResult.bitmap, dataset.colormap, width, height);
      } else {
        textureCanvas = bitmapToCanvas(rasterResult.bitmap, width, height);
      }
    }

    // Apply RGB color tinting for satellite imagery
    if (rasterOptions.satelliteRgbColors) {
      applyRgbColorTint(textureCanvas, rasterOptions.satelliteRgbColors);
    }

    // Apply polygon mask if a boundary was selected
    if (useBoundaryMask && currentBoundaryGeoJSON) {
      maskCanvasWithPolygon(textureCanvas, currentBoundaryGeoJSON, bbox);
    }

    const texture = canvasToTexture(textureCanvas);

    // Remove old terrain
    if (terrainGroup) {
      scene.remove(terrainGroup);
      terrainGroup.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (child.material.map) child.material.map.dispose();
          child.material.dispose();
        }
      });
    }

    // Build terrain mesh (pass boundary for polygon clipping / floating island)
    terrainGroup = buildTerrainMesh(elevationData, texture, {
      zScale,
      baseDepth: currentBaseDepth,
      boundary: useBoundaryMask ? currentBoundaryGeoJSON : null,
      bbox,
    });
    const ySlider = document.getElementById('yposition-slider');
    const yPos = ySlider ? parseFloat(ySlider.value) : 0;
    terrainGroup.position.y = yPos;
    updateShadowAnchor(terrainGroup);
    scene.add(terrainGroup);

    // Build title
    const titleEl = document.getElementById('map-title');
    const subtitle = mode === 'satellite'
      ? `${dataset.name}${satelliteAnchorDate ? ` ${satelliteAnchorDate}` : (satelliteSceneDate ? ` ${satelliteSceneDate}` : '')}${satelliteVisMode ? ` (${satelliteVisMode.toUpperCase()})` : ''}`
      : `${dataset.name} ${selectedYear || ''}`;
    currentTitle = subtitle.trim();

    // Update legend via viz state
    const legendData = getVizLegend(currentVizData, currentVizParams, currentTitle);
    updateLegend(legendData);

    // Update title overlay
    updateTitle(titleEl.textContent, currentTitle);

    // Populate viz controls
    populateVizControls(currentVizData, currentVizParams);

    // If path tracer is active, update it
    if (activeRenderer && activeRenderer.type === 'pathtracer' && activeRenderer.updateScene) {
      activeRenderer.updateScene();
    }

    hideLoading();
  } catch (error) {
    console.error('Generation failed:', error);
    hideLoading();
    alert(`Error generating map: ${error.message}`);
  }
}

/**
 * Apply RGB color tinting to a canvas.
 * Instead of standard R/G/B channels, each channel's intensity is multiplied
 * by the user-chosen color. Default colors (#ff0000, #00ff00, #0000ff) = identity.
 */
function applyRgbColorTint(canvas, colors) {
  if (!colors || colors.length !== 3) return;
  // Check if colors are default (identity) — skip if so
  const isDefault = colors[0] === '#ff0000' && colors[1] === '#00ff00' && colors[2] === '#0000ff';
  if (isDefault) return;

  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imageData.data;

  // Parse hex colors to [r,g,b] normalized 0-1
  const ch = colors.map(hex => {
    const h = hex.replace('#', '');
    return [
      parseInt(h.substring(0, 2), 16) / 255,
      parseInt(h.substring(2, 4), 16) / 255,
      parseInt(h.substring(4, 6), 16) / 255,
    ];
  });

  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255;
    const g = d[i + 1] / 255;
    const b = d[i + 2] / 255;
    d[i]     = Math.min(255, Math.round((r * ch[0][0] + g * ch[1][0] + b * ch[2][0]) * 255));
    d[i + 1] = Math.min(255, Math.round((r * ch[0][1] + g * ch[1][1] + b * ch[2][1]) * 255));
    d[i + 2] = Math.min(255, Math.round((r * ch[0][2] + g * ch[1][2] + b * ch[2][2]) * 255));
  }

  ctx.putImageData(imageData, 0, 0);
}

/**
 * Auto-determine the best resolution for the given source.
 * Custom rasters use native resolution (capped). API sources use safe maximums.
 */
function getAutoResolution(mode, dataset, customRaster) {
  const ABS_MAX = 4096;
  const DEFAULT_RES = 1024;

  // Check if user selected a specific resolution
  const resSelect = document.getElementById('resolution-select');
  const userChoice = resSelect ? resSelect.value : 'auto';

  if (userChoice !== 'auto') {
    const requested = parseInt(userChoice, 10);
    // Cap at dataset's maxResolution if defined, otherwise at ABS_MAX
    const datasetMax = (dataset && dataset.maxResolution) || ABS_MAX;
    return Math.min(requested, datasetMax);
  }

  // Auto mode
  if (mode === 'custom' && customRaster) {
    const nativeMax = Math.max(customRaster.width || 512, customRaster.height || 512);
    return Math.min(nativeMax, ABS_MAX);
  }

  if (!dataset) return DEFAULT_RES;

  // Use dataset's maxResolution if defined, otherwise default
  return dataset.maxResolution || DEFAULT_RES;
}

async function fetchRaster(dataset, bbox, width, height, year, options = {}) {
  switch (dataset.source) {
    case 'esri':
      return fetchESRILulc(bbox, width, height, year);
    case 'esri-tiles':
      return fetchESRITiles(bbox, width, height, year);
    case 'osm-tiles':
      return fetchOSMTiles(bbox, width, height);
    case 'esri-world-imagery':
      return fetchESRIWorldImagery(bbox, width, height);
    case 'google-satellite':
      return fetchGoogleSatellite(bbox, width, height);
    case 'custom-upload': {
      const { renderUploadedRasterToBitmap } = await import('./data/custom-raster.js');
      const bitmap = await renderUploadedRasterToBitmap(options.customRaster, bbox, width, height);
      return { bitmap, isRawClassValues: false };
    }
    default:
      throw new Error(`Unknown data source: ${dataset.source}`);
  }
}

function handleApplyViz(newVizParams) {
  if (!currentVizData || !terrainGroup) return;

  currentVizParams = newVizParams;

  // Re-render texture from viz state
  let textureCanvas = renderVizToCanvas(currentVizData, newVizParams, currentTextureWidth, currentTextureHeight);
  if (!textureCanvas) return;

  // Apply polygon mask if applicable
  if (currentUseBoundaryMask && currentBoundaryGeoJSON && currentBbox) {
    maskCanvasWithPolygon(textureCanvas, currentBoundaryGeoJSON, currentBbox);
  }

  // Update mesh texture (top surface = children[0])
  const topMesh = terrainGroup.children[0];
  if (topMesh && topMesh.material) {
    if (topMesh.material.map) topMesh.material.map.dispose();
    topMesh.material.map = canvasToTexture(textureCanvas);
    topMesh.material.needsUpdate = true;
  }

  // Update legend
  const legendData = getVizLegend(currentVizData, newVizParams, currentTitle);
  updateLegend(legendData);

  // Reset path tracer if active
  if (activeRenderer && activeRenderer.type === 'pathtracer' && activeRenderer.reset) {
    activeRenderer.reset();
  }
}

function handleApplyVectors(layers) {
  if (!terrainGroup || !currentBbox) return;

  // Re-render the base texture first (from viz state)
  let textureCanvas;
  if (currentVizData && currentVizParams) {
    textureCanvas = renderVizToCanvas(currentVizData, currentVizParams, currentTextureWidth, currentTextureHeight);
  }
  if (!textureCanvas) return;

  // Apply polygon mask if applicable
  if (currentUseBoundaryMask && currentBoundaryGeoJSON && currentBbox) {
    maskCanvasWithPolygon(textureCanvas, currentBoundaryGeoJSON, currentBbox);
  }

  // Draw vector layers on top of the texture
  console.log('[vectors] Rendering on canvas:', textureCanvas.width, 'x', textureCanvas.height,
    'bbox:', currentBbox, 'layers:', layers.length,
    'source:', currentDataset?.source, 'mercator:', isRasterMercator());
  if (layers.length > 0 && layers[0].geojson.features.length > 0) {
    const f0 = layers[0].geojson.features[0];
    const coords = f0.geometry?.coordinates;
    console.log('[vectors] First feature type:', f0.geometry?.type, 'coords sample:',
      Array.isArray(coords?.[0]?.[0]) ? coords[0][0] : coords?.[0] || coords);
  }
  renderVectorsOnCanvas(textureCanvas, layers, currentBbox);

  // Update mesh texture
  const topMesh = terrainGroup.children[0];
  if (topMesh && topMesh.material) {
    if (topMesh.material.map) topMesh.material.map.dispose();
    topMesh.material.map = canvasToTexture(textureCanvas);
    topMesh.material.needsUpdate = true;
  }

  if (activeRenderer && activeRenderer.type === 'pathtracer' && activeRenderer.reset) {
    activeRenderer.reset();
  }
}

function isRasterMercator() {
  if (!currentDataset) return false;
  const src = currentDataset.source;
  // Only actual tile-based sources use Web Mercator; ESRI ImageServer uses EPSG:4326
  return src === 'osm-tiles' || src === 'esri-world-imagery';
}

function renderVectorsOnCanvas(canvas, layers, bbox) {
  const ctx = canvas.getContext('2d');
  const [xmin, ymin, xmax, ymax] = bbox;
  const w = canvas.width;
  const h = canvas.height;
  const useMercator = isRasterMercator();
  const offset = getVectorOffset();

  // Apply global pixel offset via canvas translate
  ctx.save();
  ctx.translate(offset.x, offset.y);

  for (const layer of layers) {
    if (!layer.visible || !layer.geojson) continue;
    const style = layer.style;

    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const fillColor = hexToRGBA(style.fillColor, style.fillOpacity);
    const pointSize = style.pointSize || 3;

    for (const feature of layer.geojson.features) {
      if (!feature.geometry) continue;
      drawGeometry(ctx, feature.geometry, xmin, ymin, xmax, ymax, w, h, fillColor, pointSize, useMercator);
    }
  }

  ctx.restore();
}

function latToMercY(lat) {
  const latRad = lat * Math.PI / 180;
  return Math.log(Math.tan(Math.PI / 4 + latRad / 2));
}

function drawGeometry(ctx, geom, xmin, ymin, xmax, ymax, w, h, fillColor, pointSize, useMercator) {
  const lngToX = (lng) => ((lng - xmin) / (xmax - xmin)) * w;
  let latToY;
  if (useMercator) {
    // Use Mercator projection for Y to match Web Mercator raster tiles
    const mercYMin = latToMercY(ymin);
    const mercYMax = latToMercY(ymax);
    latToY = (lat) => ((mercYMax - latToMercY(lat)) / (mercYMax - mercYMin)) * h;
  } else {
    // Equirectangular (EPSG:4326) — matches GEE/ESRI ImageServer sources
    latToY = (lat) => ((ymax - lat) / (ymax - ymin)) * h;
  }

  switch (geom.type) {
    case 'Point':
    case 'MultiPoint': {
      const points = geom.type === 'Point' ? [geom.coordinates] : geom.coordinates;
      for (const [lng, lat] of points) {
        const x = lngToX(lng);
        const y = latToY(lat);
        ctx.beginPath();
        ctx.arc(x, y, pointSize, 0, Math.PI * 2);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fill();
      }
      break;
    }
    case 'LineString': {
      drawLine(ctx, geom.coordinates, lngToX, latToY);
      break;
    }
    case 'MultiLineString': {
      for (const line of geom.coordinates) {
        drawLine(ctx, line, lngToX, latToY);
      }
      break;
    }
    case 'Polygon': {
      drawPolygon(ctx, geom.coordinates, lngToX, latToY, fillColor);
      break;
    }
    case 'MultiPolygon': {
      for (const polygon of geom.coordinates) {
        drawPolygon(ctx, polygon, lngToX, latToY, fillColor);
      }
      break;
    }
    case 'GeometryCollection': {
      for (const g of geom.geometries) {
        drawGeometry(ctx, g, xmin, ymin, xmax, ymax, w, h, fillColor, pointSize, useMercator);
      }
      break;
    }
  }
}

function drawLine(ctx, coords, lngToX, latToY) {
  if (coords.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(lngToX(coords[0][0]), latToY(coords[0][1]));
  for (let i = 1; i < coords.length; i++) {
    ctx.lineTo(lngToX(coords[i][0]), latToY(coords[i][1]));
  }
  ctx.stroke();
}

function drawPolygon(ctx, rings, lngToX, latToY, fillColor) {
  ctx.beginPath();
  for (const ring of rings) {
    if (ring.length < 3) continue;
    ctx.moveTo(lngToX(ring[0][0]), latToY(ring[0][1]));
    for (let i = 1; i < ring.length; i++) {
      ctx.lineTo(lngToX(ring[i][0]), latToY(ring[i][1]));
    }
    ctx.closePath();
  }
  if (fillColor) {
    ctx.fillStyle = fillColor;
    ctx.fill();
  }
  ctx.stroke();
}

function hexToRGBA(hex, opacity) {
  if (!hex) return null;
  hex = hex.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}

function handleZScaleChange(newZScale) {
  if (terrainGroup && currentElevationData) {
    updateTerrainZScale(terrainGroup, currentElevationData, newZScale, currentBaseDepth);
    if (activeRenderer && activeRenderer.type === 'pathtracer' && activeRenderer.reset) {
      activeRenderer.reset();
    }
  }
}

function handleBaseDepthChange(newBaseDepth) {
  currentBaseDepth = newBaseDepth;
  if (terrainGroup && currentElevationData) {
    const zScale = parseFloat(document.getElementById('zscale-slider').value);
    updateTerrainZScale(terrainGroup, currentElevationData, zScale, newBaseDepth);
    if (activeRenderer && activeRenderer.type === 'pathtracer' && activeRenderer.reset) {
      activeRenderer.reset();
    }
  }
}

function handleYPositionChange(newY) {
  if (terrainGroup) {
    terrainGroup.position.y = newY;
    updateShadowAnchor(terrainGroup);
    if (activeRenderer && activeRenderer.type === 'pathtracer' && activeRenderer.reset) {
      activeRenderer.reset();
    }
  }
}

function handleShadowOffsetChange(offsetX, offsetZ) {
  if (terrainGroup) {
    updateShadowOffset(terrainGroup, offsetX, offsetZ);
    if (activeRenderer && activeRenderer.type === 'pathtracer' && activeRenderer.reset) {
      activeRenderer.reset();
    }
  }
}

function handleCameraPreset(presetName) {
  const preset = CAMERA_PRESETS[presetName];
  if (!preset) return;

  camera.position.set(...preset.pos);
  controls.target.set(...preset.target);
  controls.update();

  if (activeRenderer && activeRenderer.type === 'pathtracer' && activeRenderer.reset) {
    activeRenderer.reset();
  }
}

function handleToggleTitle(visible) {
  const el = document.getElementById('title-overlay');
  el.classList.toggle('hidden', !visible);
}

function handleToggleLegend(visible) {
  const el = document.getElementById('legend');
  el.classList.toggle('hidden', !visible);
}

function initLegendDrag() {
  const legend = document.getElementById('legend');
  let isDragging = false;
  let startX, startY, startLeft, startBottom;

  legend.addEventListener('mousedown', (e) => {
    isDragging = true;
    legend.classList.add('dragging');
    startX = e.clientX;
    startY = e.clientY;
    const rect = legend.getBoundingClientRect();
    startLeft = rect.left;
    startBottom = window.innerHeight - rect.bottom;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    legend.style.left = (startLeft + dx) + 'px';
    legend.style.bottom = (startBottom - dy) + 'px';
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
    legend.classList.remove('dragging');
  });
}

async function handleRenderModeChange(mode) {
  renderMode = mode;

  if (mode === 'pathtracer') {
    if (!pathtracerRenderer) {
      showLoading('Initializing path tracer...');
      pathtracerRenderer = await setupPathTracerRenderer(canvas, scene, camera);
      hideLoading();
    }

    if (pathtracerRenderer) {
      activeRenderer = pathtracerRenderer;
      if (pathtracerRenderer.updateScene) {
        pathtracerRenderer.updateScene();
      }
    } else {
      alert('Path tracer is not available. Make sure three-gpu-pathtracer is installed.');
      document.getElementById('btn-rasterizer').classList.add('active');
      document.getElementById('btn-pathtracer').classList.remove('active');
    }
  } else {
    activeRenderer = rasterizerRenderer;
    updateSampleCounter(0, false);
  }
}

function handleExport() {
  if (!canvas || !activeRenderer) return;

  // Read export scale (1x / 2x / 3x / 4x) from the UI; defaults to 2x.
  const scaleEl = document.getElementById('export-scale');
  const scale = scaleEl ? Math.max(1, Math.min(4, parseInt(scaleEl.value, 10) || 2)) : 2;

  const viewport = document.getElementById('viewport');
  const baseW = viewport.clientWidth;
  const baseH = viewport.clientHeight;
  const targetW = baseW * scale;
  const targetH = baseH * scale;

  // Guard against canvas/GPU texture limits. 16384 is the typical hard cap.
  const MAX_EXPORT_SIDE = 8192;
  if (targetW > MAX_EXPORT_SIDE || targetH > MAX_EXPORT_SIDE) {
    alert(`Requested export (${targetW}x${targetH}) exceeds the ${MAX_EXPORT_SIDE}px safe limit. Try a smaller scale.`);
    return;
  }

  const renderer = activeRenderer.renderer;
  let restoreSize = null;
  try {
    if (renderer && activeRenderer.type === 'rasterizer') {
      renderer.setPixelRatio(1);
      renderer.setSize(targetW, targetH, false);
      restoreSize = () => {
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(baseW, baseH, false);
      };
    }
    activeRenderer.render();
    const dataUrl = canvas.toDataURL('image/png');
    // Catch the silent "all-black PNG" case browsers emit when a canvas is too big.
    if (!dataUrl || dataUrl === 'data:,' || dataUrl.length < 200) {
      throw new Error('Browser returned an empty PNG. Canvas may exceed the GPU texture limit.');
    }
    const link = document.createElement('a');
    link.download = `3d-landcover-map-${targetW}x${targetH}.png`;
    link.href = dataUrl;
    link.click();
  } catch (e) {
    console.error('Export failed:', e);
    alert(`Export failed: ${e.message}`);
  } finally {
    if (restoreSize) restoreSize();
    handleResize();
  }
}

function handleResize() {
  const viewport = document.getElementById('viewport');
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;

  camera.aspect = w / h;
  camera.updateProjectionMatrix();

  if (rasterizerRenderer && rasterizerRenderer.resize) {
    rasterizerRenderer.resize(w, h);
  }

  if (activeRenderer && activeRenderer.type === 'pathtracer' && activeRenderer.reset) {
    activeRenderer.reset();
  }

  // Also invalidate leaflet map size
  if (leafletMap) {
    leafletMap.invalidateSize();
  }
}

// Initialize
init();
