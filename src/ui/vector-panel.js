// Vector overlay panel — manages GeoJSON uploads, OSM data fetching, and layer rendering

let vectorLayers = []; // { id, name, geojson, style: { color, width, fillColor, fillOpacity }, visible }
let onApplyCallback = null;
let currentBbox = null;
let globalOffsetX = 0; // pixels
let globalOffsetY = 0; // pixels

export function initVectorPanel({ onApplyVectors }) {
  onApplyCallback = onApplyVectors;

  const panel = document.getElementById('vector-panel');
  const toggleBtn = document.getElementById('vector-panel-toggle');
  const closeBtn = document.getElementById('btn-close-vector-panel');

  toggleBtn.addEventListener('click', () => {
    panel.classList.toggle('open');
  });

  closeBtn.addEventListener('click', () => {
    panel.classList.remove('open');
  });

  // GeoJSON upload
  const uploadInput = document.getElementById('vector-upload');
  uploadInput.addEventListener('change', handleGeoJSONUpload);

  // OSM preset buttons
  document.querySelectorAll('#osm-presets button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('osm-filter-tags').value = btn.dataset.tag;
    });
  });

  // Fetch OSM
  document.getElementById('btn-fetch-osm').addEventListener('click', handleFetchOSM);

  // ESRI Feature Service presets — one-click fetch
  document.querySelectorAll('#esri-feature-presets button').forEach(btn => {
    btn.addEventListener('click', () => {
      handleFetchESRIFeatures(btn.dataset.service);
    });
  });

  // Alignment offset sliders
  const offsetXSlider = document.getElementById('vector-offset-x');
  const offsetYSlider = document.getElementById('vector-offset-y');
  const offsetXVal = document.getElementById('vector-offset-x-val');
  const offsetYVal = document.getElementById('vector-offset-y-val');

  offsetXSlider.addEventListener('input', () => {
    globalOffsetX = parseFloat(offsetXSlider.value) || 0;
    offsetXVal.textContent = globalOffsetX;
  });
  offsetYSlider.addEventListener('input', () => {
    globalOffsetY = parseFloat(offsetYSlider.value) || 0;
    offsetYVal.textContent = globalOffsetY;
  });

  // Apply vectors to map
  document.getElementById('btn-apply-vectors').addEventListener('click', () => {
    if (onApplyCallback) {
      onApplyCallback(getVisibleLayers());
    }
  });
}

export function setVectorBbox(bbox) {
  currentBbox = bbox;
}

export function getVisibleLayers() {
  return vectorLayers.filter(l => l.visible);
}

export function getVectorOffset() {
  return { x: globalOffsetX, y: globalOffsetY };
}

// --- GeoJSON Upload ---

function handleGeoJSONUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const geojson = JSON.parse(evt.target.result);
      if (!geojson.type || (!geojson.features && geojson.type !== 'Feature' && geojson.type !== 'GeometryCollection')) {
        throw new Error('Invalid GeoJSON');
      }
      // Normalize to FeatureCollection
      const fc = geojson.type === 'FeatureCollection'
        ? geojson
        : geojson.type === 'Feature'
          ? { type: 'FeatureCollection', features: [geojson] }
          : { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: geojson, properties: {} }] };

      addLayer(file.name.replace(/\.(geo)?json$/i, ''), fc);
    } catch (err) {
      console.error('GeoJSON parse error:', err);
      alert('Failed to parse GeoJSON file: ' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

// --- OSM Overpass ---

const OVERPASS_SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

async function fetchOverpassWithRetry(query, statusBtn) {
  const body = `data=${encodeURIComponent(query)}`;
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };

  for (let attempt = 0; attempt < OVERPASS_SERVERS.length; attempt++) {
    const server = OVERPASS_SERVERS[attempt];
    const serverName = new URL(server).hostname.split('.').slice(-2, -1)[0];
    if (attempt > 0) {
      statusBtn.textContent = `Retrying (${serverName})...`;
    }
    try {
      const resp = await fetch(server, { method: 'POST', body, headers });
      if (resp.ok) {
        return await resp.json();
      }
      console.warn(`[overpass] ${serverName} returned ${resp.status}, trying next...`);
    } catch (err) {
      console.warn(`[overpass] ${serverName} failed:`, err.message);
    }
  }
  throw new Error('All Overpass servers failed. Try a smaller area or wait a minute.');
}

async function handleFetchOSM() {
  if (!currentBbox) {
    alert('Select a location first to fetch OSM data.');
    return;
  }

  const tagInput = document.getElementById('osm-filter-tags').value.trim();
  if (!tagInput) {
    alert('Enter an OSM tag to filter (e.g. "building", "highway=primary").');
    return;
  }

  const btn = document.getElementById('btn-fetch-osm');
  btn.disabled = true;
  btn.textContent = 'Fetching...';

  try {
    const [xmin, ymin, xmax, ymax] = currentBbox;
    const bboxStr = `${ymin},${xmin},${ymax},${xmax}`; // Overpass uses S,W,N,E

    // Build Overpass query from tag input
    const tags = tagInput.split(',').map(t => t.trim()).filter(Boolean);
    const queryParts = tags.map(tag => {
      const [key, val] = tag.split('=');
      const filter = val ? `["${key}"="${val}"]` : `["${key}"]`;
      return `way${filter}(${bboxStr});relation${filter}(${bboxStr});`;
    });

    const query = `[out:json][timeout:180][maxsize:536870912];(${queryParts.join('')});out body;>;out skel qt;`;
    const data = await fetchOverpassWithRetry(query, btn);
    const geojson = osmToGeoJSON(data);

    if (!geojson.features.length) {
      alert(`No features found for "${tagInput}" in this area.`);
      return;
    }

    addLayer(`OSM: ${tagInput}`, geojson);
  } catch (err) {
    console.error('OSM fetch error:', err);
    alert('Failed to fetch OSM data: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Fetch OSM Data';
  }
}

// --- Convert Overpass JSON to GeoJSON ---

function osmToGeoJSON(osmData) {
  const nodes = {};
  const features = [];

  // Index nodes
  for (const el of osmData.elements) {
    if (el.type === 'node') {
      nodes[el.id] = [el.lon, el.lat];
    }
  }

  for (const el of osmData.elements) {
    if (el.type === 'node' && el.tags) {
      features.push({
        type: 'Feature',
        properties: el.tags || {},
        geometry: { type: 'Point', coordinates: nodes[el.id] },
      });
    } else if (el.type === 'way' && el.nodes) {
      const coords = el.nodes.map(id => nodes[id]).filter(Boolean);
      if (coords.length < 2) continue;

      const isClosed = el.nodes[0] === el.nodes[el.nodes.length - 1] && coords.length >= 4;
      features.push({
        type: 'Feature',
        properties: el.tags || {},
        geometry: isClosed
          ? { type: 'Polygon', coordinates: [coords] }
          : { type: 'LineString', coordinates: coords },
      });
    }
  }

  return { type: 'FeatureCollection', features };
}

// --- ESRI Feature Services (ArcGIS Online — CORS-enabled) ---

const ESRI_FEATURE_PRESETS = {
  'water-bodies': {
    url: 'https://services.arcgis.com/P3ePLMYs2RVChkJx/ArcGIS/rest/services/USA_Water_Bodies/FeatureServer/0',
    name: 'Water Bodies (US)',
  },
  'rivers': {
    url: 'https://services.arcgis.com/P3ePLMYs2RVChkJx/ArcGIS/rest/services/USA_Rivers_and_Streams/FeatureServer/0',
    name: 'Rivers & Streams (US)',
  },
  'parks': {
    url: 'https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Parks/FeatureServer/0',
    name: 'Parks (US)',
  },
  'counties': {
    url: 'https://services.arcgis.com/P3ePLMYs2RVChkJx/ArcGIS/rest/services/USA_Counties_Generalized/FeatureServer/0',
    name: 'Counties (US)',
  },
  'federal-lands': {
    url: 'https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Federal_Lands/FeatureServer/0',
    name: 'Federal Lands (US)',
  },
  'countries': {
    url: 'https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/World_Countries/FeatureServer/0',
    name: 'Countries (Global)',
  },
};

async function handleFetchESRIFeatures(presetKey) {
  if (!currentBbox) {
    alert('Select a location first.');
    return;
  }

  const preset = ESRI_FEATURE_PRESETS[presetKey];
  if (!preset) return;

  // Disable all preset buttons while fetching
  const allBtns = document.querySelectorAll('#esri-feature-presets button');
  allBtns.forEach(b => { b.disabled = true; });
  const clickedBtn = document.querySelector(`#esri-feature-presets button[data-service="${presetKey}"]`);
  if (clickedBtn) clickedBtn.textContent = 'Loading...';

  try {
    const [xmin, ymin, xmax, ymax] = currentBbox;
    const geojson = await fetchESRIFeaturesPaginated(preset.url, xmin, ymin, xmax, ymax);

    if (!geojson.features.length) {
      alert(`No ${preset.name} found in this area.`);
      return;
    }

    addLayer(preset.name, geojson);
  } catch (err) {
    console.error('ESRI feature fetch error:', err);
    alert('Failed to fetch features: ' + err.message);
  } finally {
    allBtns.forEach(b => { b.disabled = false; });
    if (clickedBtn) clickedBtn.textContent = clickedBtn.dataset.label;
  }
}

async function fetchESRIFeaturesPaginated(baseUrl, xmin, ymin, xmax, ymax) {
  const allFeatures = [];
  let offset = 0;
  const pageSize = 2000;
  const maxPages = 10; // Safety limit

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      where: '1=1',
      geometry: `${xmin},${ymin},${xmax},${ymax}`,
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      outSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: '*',
      returnGeometry: 'true',
      f: 'geojson',
      resultOffset: offset,
      resultRecordCount: pageSize,
    });

    const resp = await fetch(`${baseUrl}/query?${params}`);
    if (!resp.ok) throw new Error(`ESRI FeatureServer error: ${resp.status}`);

    const data = await resp.json();

    if (data.error) {
      throw new Error(data.error.message || 'ESRI query failed');
    }

    if (data.features) {
      allFeatures.push(...data.features);
    }

    // Check if there are more pages
    const exceeded = data.exceededTransferLimit || data.properties?.exceededTransferLimit;
    if (!exceeded || !data.features || data.features.length < pageSize) {
      break;
    }
    offset += pageSize;
  }

  return { type: 'FeatureCollection', features: allFeatures };
}

// --- Layer Management ---

let layerIdCounter = 0;

const DEFAULT_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

function addLayer(name, geojson) {
  const id = ++layerIdCounter;
  const colorIdx = (vectorLayers.length) % DEFAULT_COLORS.length;
  const layer = {
    id,
    name,
    geojson,
    style: {
      color: DEFAULT_COLORS[colorIdx],
      width: 2,
      fillColor: DEFAULT_COLORS[colorIdx],
      fillOpacity: 0.15,
      pointSize: 3,
    },
    visible: true,
  };
  vectorLayers.push(layer);
  renderLayerList();
}

function removeLayer(id) {
  vectorLayers = vectorLayers.filter(l => l.id !== id);
  renderLayerList();
}

function renderLayerList() {
  const container = document.getElementById('vector-layer-list');
  container.innerHTML = '';

  const inputStyle = 'font-size:11px;padding:1px 3px;background:#0f172a;border:1px solid #334155;color:#e2e8f0;border-radius:3px;';

  for (const layer of vectorLayers) {
    const item = document.createElement('div');
    item.className = 'vector-layer-item';

    // --- Top row: name + visibility + remove ---
    const topRow = document.createElement('div');
    topRow.className = 'layer-top-row';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'layer-name';
    nameSpan.textContent = `${layer.name} (${layer.geojson.features.length})`;
    nameSpan.title = layer.name;

    const topActions = document.createElement('div');
    topActions.style.cssText = 'display:flex;gap:4px;align-items:center;';

    const toggleBtn = document.createElement('button');
    toggleBtn.textContent = layer.visible ? '👁' : '—';
    toggleBtn.title = layer.visible ? 'Hide' : 'Show';
    toggleBtn.addEventListener('click', () => {
      layer.visible = !layer.visible;
      toggleBtn.textContent = layer.visible ? '👁' : '—';
      toggleBtn.title = layer.visible ? 'Hide' : 'Show';
    });

    const removeBtn = document.createElement('button');
    removeBtn.textContent = '✕';
    removeBtn.title = 'Remove layer';
    removeBtn.addEventListener('click', () => removeLayer(layer.id));

    topActions.appendChild(toggleBtn);
    topActions.appendChild(removeBtn);
    topRow.appendChild(nameSpan);
    topRow.appendChild(topActions);

    // --- Style row: stroke color, fill color, width, fill opacity, point size ---
    const styleRow = document.createElement('div');
    styleRow.className = 'layer-style-row';

    // Stroke color
    const strokeLabel = document.createElement('label');
    strokeLabel.textContent = 'Stroke';
    strokeLabel.style.cssText = 'font-size:10px;color:#94a3b8;';
    const strokeColor = document.createElement('input');
    strokeColor.type = 'color';
    strokeColor.className = 'layer-color';
    strokeColor.value = layer.style.color;
    strokeColor.title = 'Stroke color';
    strokeColor.addEventListener('input', (e) => { layer.style.color = e.target.value; });

    // Fill color
    const fillLabel = document.createElement('label');
    fillLabel.textContent = 'Fill';
    fillLabel.style.cssText = 'font-size:10px;color:#94a3b8;';
    const fillColor = document.createElement('input');
    fillColor.type = 'color';
    fillColor.className = 'layer-color';
    fillColor.value = layer.style.fillColor;
    fillColor.title = 'Fill color';
    fillColor.addEventListener('input', (e) => { layer.style.fillColor = e.target.value; });

    // Stroke width
    const widthLabel = document.createElement('label');
    widthLabel.textContent = 'Width';
    widthLabel.style.cssText = 'font-size:10px;color:#94a3b8;';
    const widthInput = document.createElement('input');
    widthInput.type = 'number';
    widthInput.min = '0.5';
    widthInput.max = '20';
    widthInput.step = '0.5';
    widthInput.value = layer.style.width;
    widthInput.title = 'Stroke width';
    widthInput.style.cssText = `width:44px;${inputStyle}`;
    widthInput.addEventListener('change', (e) => {
      layer.style.width = parseFloat(e.target.value) || 2;
    });

    // Fill opacity
    const opacityLabel = document.createElement('label');
    opacityLabel.textContent = 'Opacity';
    opacityLabel.style.cssText = 'font-size:10px;color:#94a3b8;';
    const opacityInput = document.createElement('input');
    opacityInput.type = 'range';
    opacityInput.min = '0';
    opacityInput.max = '1';
    opacityInput.step = '0.05';
    opacityInput.value = layer.style.fillOpacity;
    opacityInput.title = `Fill opacity: ${layer.style.fillOpacity}`;
    opacityInput.style.cssText = 'width:60px;height:14px;accent-color:#6366f1;';
    opacityInput.addEventListener('input', (e) => {
      layer.style.fillOpacity = parseFloat(e.target.value);
      opacityInput.title = `Fill opacity: ${layer.style.fillOpacity}`;
    });

    // Point size
    const ptLabel = document.createElement('label');
    ptLabel.textContent = 'Pt size';
    ptLabel.style.cssText = 'font-size:10px;color:#94a3b8;';
    const ptInput = document.createElement('input');
    ptInput.type = 'number';
    ptInput.min = '1';
    ptInput.max = '30';
    ptInput.step = '1';
    ptInput.value = layer.style.pointSize;
    ptInput.title = 'Point size';
    ptInput.style.cssText = `width:44px;${inputStyle}`;
    ptInput.addEventListener('change', (e) => {
      layer.style.pointSize = parseFloat(e.target.value) || 3;
    });

    // Build style row as a grid
    const makeGroup = (label, control) => {
      const g = document.createElement('div');
      g.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:2px;';
      g.appendChild(label);
      g.appendChild(control);
      return g;
    };

    styleRow.appendChild(makeGroup(strokeLabel, strokeColor));
    styleRow.appendChild(makeGroup(fillLabel, fillColor));
    styleRow.appendChild(makeGroup(widthLabel, widthInput));
    styleRow.appendChild(makeGroup(opacityLabel, opacityInput));
    styleRow.appendChild(makeGroup(ptLabel, ptInput));

    item.appendChild(topRow);
    item.appendChild(styleRow);
    container.appendChild(item);
  }
}
