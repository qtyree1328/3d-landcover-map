// Visualization controls UI — band assignment, palette picker, class color editor
import { PALETTE_NAMES, paletteGradientCSS } from '../viz/palettes.js';

let onApplyVizCallback = null;
let currentVizData = null;
let currentVizParams = null;

export function initVizControls({ onApplyViz }) {
  onApplyVizCallback = onApplyViz;

  const modeSelect = document.getElementById('viz-mode-select');
  const applyBtn = document.getElementById('btn-apply-viz');
  const paletteSelect = document.getElementById('viz-palette-select');

  // Populate palette dropdown
  PALETTE_NAMES.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name.charAt(0).toUpperCase() + name.slice(1);
    paletteSelect.appendChild(opt);
  });

  // Mode change
  modeSelect.addEventListener('change', () => {
    updateModeVisibility(modeSelect.value);
  });

  // Palette change — update preview
  paletteSelect.addEventListener('change', () => {
    updatePalettePreview(paletteSelect.value);
  });

  // Apply button
  applyBtn.addEventListener('click', () => {
    if (!currentVizData || !onApplyVizCallback) return;
    const params = collectVizParams();
    currentVizParams = params;
    onApplyVizCallback(params);
  });
}

/**
 * Populate viz controls after a raster is loaded.
 */
export function populateVizControls(vizData, vizParams) {
  currentVizData = vizData;
  currentVizParams = vizParams;

  const infoEl = document.getElementById('viz-raster-info');
  const modeSelect = document.getElementById('viz-mode-select');

  // Update raster info
  if (vizData.sourceType === 'custom-bands') {
    infoEl.textContent = `${vizData.bandCount} band${vizData.bandCount > 1 ? 's' : ''} | ${vizData.srcWidth}×${vizData.srcHeight} px | Detected: ${vizData.detectedMode}`;
  } else if (vizData.sourceType === 'classified-bitmap') {
    const nClasses = vizData.classValues ? vizData.classValues.length : '?';
    infoEl.textContent = `Classified bitmap | ${nClasses} classes | ${vizData.width}×${vizData.height} px`;
  } else {
    infoEl.textContent = `Pre-rendered | ${vizData.width}×${vizData.height} px | Type: ${vizData.datasetType}`;
  }

  // Set mode
  modeSelect.value = vizParams.mode === 'single-band' ? 'single-band' : vizParams.mode;

  // Populate band dropdowns
  populateBandDropdowns(vizData);

  // Set RGB band selections
  const bandR = document.getElementById('viz-band-r');
  const bandG = document.getElementById('viz-band-g');
  const bandB = document.getElementById('viz-band-b');
  bandR.value = vizParams.rgbBands.r;
  bandG.value = vizParams.rgbBands.g;
  bandB.value = vizParams.rgbBands.b;

  // Set single-band controls
  const sbSelect = document.getElementById('viz-singleband-select');
  populateSingleBandDropdown(vizData, sbSelect);
  sbSelect.value = vizParams.singleBand;

  const paletteSelect = document.getElementById('viz-palette-select');
  paletteSelect.value = vizParams.palette;
  updatePalettePreview(vizParams.palette);

  document.getElementById('viz-stretch-min').value = vizParams.stretchMin;
  document.getElementById('viz-stretch-max').value = vizParams.stretchMax;

  // Populate class color editor
  populateClassEditor(vizData, vizParams);

  // Show/hide mode-specific controls
  updateModeVisibility(vizParams.mode);

  // Enable/disable mode options based on source type
  updateModeOptions(vizData);
}

function populateBandDropdowns(vizData) {
  const selects = ['viz-band-r', 'viz-band-g', 'viz-band-b'];
  const bandCount = vizData.sourceType === 'custom-bands' ? vizData.bandCount : 3;

  selects.forEach(id => {
    const el = document.getElementById(id);
    el.innerHTML = '';
    for (let i = 0; i < bandCount; i++) {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `Band ${i + 1}`;
      el.appendChild(opt);
    }
  });
}

function populateSingleBandDropdown(vizData, selectEl) {
  selectEl.innerHTML = '';
  const bandCount = vizData.sourceType === 'custom-bands' ? vizData.bandCount : 1;
  for (let i = 0; i < bandCount; i++) {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `Band ${i + 1}`;
    selectEl.appendChild(opt);
  }
}

function populateClassEditor(vizData, vizParams) {
  const container = document.getElementById('viz-class-list');
  container.innerHTML = '';

  const classColors = vizParams.classColors || {};
  const sortedValues = Object.keys(classColors).map(Number).sort((a, b) => a - b);

  if (sortedValues.length === 0) {
    container.innerHTML = '<div class="hint">No class values detected.</div>';
    return;
  }

  sortedValues.forEach(val => {
    const cc = classColors[val];
    const entry = document.createElement('div');
    entry.className = 'viz-class-entry';
    entry.dataset.value = val;

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'viz-class-color';
    colorInput.value = cc.color;

    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.className = 'viz-class-label';
    labelInput.value = cc.label;

    const valSpan = document.createElement('span');
    valSpan.className = 'viz-class-value';
    valSpan.textContent = val;

    entry.appendChild(colorInput);
    entry.appendChild(labelInput);
    entry.appendChild(valSpan);
    container.appendChild(entry);
  });
}

function updateModeVisibility(mode) {
  document.getElementById('viz-rgb-controls').style.display = mode === 'rgb' ? '' : 'none';
  document.getElementById('viz-singleband-controls').style.display = mode === 'single-band' ? '' : 'none';
  document.getElementById('viz-classified-controls').style.display = mode === 'classified' ? '' : 'none';
}

function updateModeOptions(vizData) {
  const modeSelect = document.getElementById('viz-mode-select');
  const options = modeSelect.querySelectorAll('option');

  options.forEach(opt => {
    opt.disabled = false;
  });

  // If not custom-bands, disable RGB band assignment (bands aren't available)
  if (vizData.sourceType !== 'custom-bands') {
    const rgbOpt = modeSelect.querySelector('option[value="rgb"]');
    if (rgbOpt && vizData.detectedMode !== 'rgb') {
      // Keep RGB available for pre-rendered RGB sources
    }
    const sbOpt = modeSelect.querySelector('option[value="single-band"]');
    if (sbOpt && vizData.sourceType === 'pre-rendered' && vizData.detectedMode !== 'continuous') {
      sbOpt.disabled = true;
    }
  }
}

function updatePalettePreview(paletteName) {
  const preview = document.getElementById('viz-palette-preview');
  if (preview) {
    preview.style.background = paletteGradientCSS(paletteName);
  }
}

function collectVizParams() {
  const modeSelect = document.getElementById('viz-mode-select');
  const mode = modeSelect.value;

  const params = {
    mode,
    rgbBands: {
      r: parseInt(document.getElementById('viz-band-r').value) || 0,
      g: parseInt(document.getElementById('viz-band-g').value) || 0,
      b: parseInt(document.getElementById('viz-band-b').value) || 0,
    },
    singleBand: parseInt(document.getElementById('viz-singleband-select').value) || 0,
    palette: document.getElementById('viz-palette-select').value || 'viridis',
    stretchMin: parseFloat(document.getElementById('viz-stretch-min').value) || 0,
    stretchMax: parseFloat(document.getElementById('viz-stretch-max').value) || 255,
    classColors: {},
  };

  // Collect class colors from editor
  const entries = document.querySelectorAll('.viz-class-entry');
  entries.forEach(entry => {
    const val = Number(entry.dataset.value);
    const colorInput = entry.querySelector('.viz-class-color');
    const labelInput = entry.querySelector('.viz-class-label');
    params.classColors[val] = {
      color: colorInput.value,
      label: labelInput.value,
    };
  });

  return params;
}
