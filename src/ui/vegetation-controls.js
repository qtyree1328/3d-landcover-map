// Vegetation panel — wires the DOM controls in #vegetation-panel to the
// callbacks main.js cares about. Reads current params via getVegetationParams.

let enabledChk;
let styleSel;
let densityRange;
let densityVal;
let minHeightRange, minHeightVal;
let maxHeightRange, maxHeightVal;
let colorJitterRange, colorJitterVal;
let maxTreesInput;
let baseColorInput;
let forestColorsInput;
let panel;

export function initVegetationPanel({ onApply, onClear }) {
  panel             = document.getElementById('vegetation-panel');
  if (!panel) return;

  enabledChk        = document.getElementById('veg-enabled');
  styleSel          = document.getElementById('veg-style');
  densityRange      = document.getElementById('veg-density');
  densityVal        = document.getElementById('veg-density-val');
  minHeightRange    = document.getElementById('veg-min-height');
  minHeightVal      = document.getElementById('veg-min-height-val');
  maxHeightRange    = document.getElementById('veg-max-height');
  maxHeightVal      = document.getElementById('veg-max-height-val');
  colorJitterRange  = document.getElementById('veg-color-jitter');
  colorJitterVal    = document.getElementById('veg-color-jitter-val');
  maxTreesInput     = document.getElementById('veg-max-trees');
  baseColorInput    = document.getElementById('veg-base-color');
  forestColorsInput = document.getElementById('veg-forest-colors');

  bindReadout(densityRange, densityVal, v => `${Math.round(v * 100)}%`);
  bindReadout(minHeightRange, minHeightVal, v => v.toFixed(3));
  bindReadout(maxHeightRange, maxHeightVal, v => v.toFixed(3));
  bindReadout(colorJitterRange, colorJitterVal, v => v.toFixed(2));

  document.getElementById('btn-veg-apply').addEventListener('click', () => onApply && onApply());
  document.getElementById('btn-veg-clear').addEventListener('click', () => onClear && onClear());

  // Side-panel toggle (matches the vector panel UX).
  const toggleBtn = document.getElementById('vegetation-panel-toggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => panel.classList.toggle('open'));
  }
}

export function isVegetationEnabled() {
  return !!(enabledChk && enabledChk.checked);
}

export function getVegetationParams() {
  return {
    style:       styleSel ? styleSel.value : 'cone',
    density:     readFloat(densityRange, 0.25),
    minHeight:   readFloat(minHeightRange, 0.006),
    maxHeight:   readFloat(maxHeightRange, 0.018),
    colorJitter: readFloat(colorJitterRange, 0.18),
    maxTrees:    Math.max(100, parseInt((maxTreesInput && maxTreesInput.value) || '60000', 10)),
    baseColor:   (baseColorInput && baseColorInput.value) || '#2f6b3d',
    forestColors: parseColorsField(forestColorsInput && forestColorsInput.value),
  };
}

function bindReadout(range, label, fmt) {
  if (!range || !label) return;
  const update = () => { label.textContent = fmt(parseFloat(range.value)); };
  range.addEventListener('input', update);
  update();
}

function readFloat(el, fallback) {
  if (!el) return fallback;
  const v = parseFloat(el.value);
  return Number.isFinite(v) ? v : fallback;
}

function parseColorsField(text) {
  if (!text) return null;
  const out = [];
  for (const tok of text.split(/[\s,]+/)) {
    const t = tok.trim();
    if (!t) continue;
    const hex = t.startsWith('#') ? t : `#${t}`;
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) out.push(hex);
  }
  return out.length ? out : null;
}
