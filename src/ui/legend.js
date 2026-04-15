// Dynamic legend generation — supports classified, continuous, and RGB info modes.
// Accepts a generic legendData object from viz-state or dataset.

import { paletteGradientCSS } from '../viz/palettes.js';

/**
 * Update the legend overlay.
 *
 * @param {Object} legendData
 *   - { type: 'classified', title, entries: [{ value, color, label }] }
 *   - { type: 'continuous', title, palette, min, max, unit }
 *   - { type: 'rgb-info', title, bandLabels: { r, g, b } }
 *   - { type: 'none' }
 *
 * Legacy support: also accepts (dataset, year) for backward compat.
 */
export function updateLegend(legendDataOrDataset, year) {
  const legendEl = document.getElementById('legend');

  // Legacy call: updateLegend(dataset, year)
  let legendData;
  if (legendDataOrDataset && legendDataOrDataset.type && !legendDataOrDataset.title && (legendDataOrDataset.colormap || legendDataOrDataset.legend)) {
    legendData = datasetToLegendData(legendDataOrDataset, year);
  } else {
    legendData = legendDataOrDataset;
  }

  if (!legendData || legendData.type === 'none') {
    legendEl.style.display = 'none';
    return;
  }

  legendEl.style.display = 'block';
  legendEl.innerHTML = '';

  // Title
  if (legendData.title) {
    const title = document.createElement('h3');
    title.textContent = legendData.title;
    legendEl.appendChild(title);
  }

  if (legendData.type === 'classified' && legendData.entries) {
    renderClassifiedLegend(legendEl, legendData.entries);
  } else if (legendData.type === 'continuous') {
    renderContinuousLegend(legendEl, legendData);
  } else if (legendData.type === 'rgb-info' && legendData.bandLabels) {
    renderRGBInfoLegend(legendEl, legendData.bandLabels);
  }
}

function renderClassifiedLegend(container, entries) {
  for (const entry of entries) {
    const item = document.createElement('div');
    item.className = 'legend-item';

    const swatch = document.createElement('div');
    swatch.className = 'legend-swatch';
    swatch.style.backgroundColor = entry.color;

    const label = document.createElement('span');
    label.className = 'legend-label';
    label.textContent = entry.label;

    item.appendChild(swatch);
    item.appendChild(label);
    container.appendChild(item);
  }
}

function renderContinuousLegend(container, data) {
  const wrapper = document.createElement('div');
  wrapper.className = 'gradient-container';

  const labels = document.createElement('div');
  labels.className = 'gradient-labels';

  const maxLabel = document.createElement('span');
  maxLabel.textContent = `${data.max}${data.unit || ''}`;
  labels.appendChild(maxLabel);

  const midVal = ((data.max + data.min) / 2).toFixed(1);
  const midLabel = document.createElement('span');
  midLabel.textContent = midVal;
  labels.appendChild(midLabel);

  const minLabel = document.createElement('span');
  minLabel.textContent = `${data.min}${data.unit || ''}`;
  labels.appendChild(minLabel);

  const bar = document.createElement('div');
  bar.className = 'gradient-bar';

  // Use palette name if available, else fallback to raw stops
  if (data.palette && typeof data.palette === 'string') {
    bar.style.background = paletteGradientCSS(data.palette, 'to top');
  } else if (Array.isArray(data.palette)) {
    const stops = data.palette.map((c, i) => `${c} ${(i / (data.palette.length - 1)) * 100}%`).reverse();
    bar.style.background = `linear-gradient(to bottom, ${stops.join(', ')})`;
  }

  wrapper.appendChild(labels);
  wrapper.appendChild(bar);
  container.appendChild(wrapper);
}

function renderRGBInfoLegend(container, bandLabels) {
  const channels = [
    { label: bandLabels.r, color: '#ef4444' },
    { label: bandLabels.g, color: '#22c55e' },
    { label: bandLabels.b, color: '#3b82f6' },
  ];

  for (const ch of channels) {
    const item = document.createElement('div');
    item.className = 'legend-item';

    const swatch = document.createElement('div');
    swatch.className = 'legend-swatch';
    swatch.style.backgroundColor = ch.color;

    const label = document.createElement('span');
    label.className = 'legend-label';
    label.textContent = ch.label;

    item.appendChild(swatch);
    item.appendChild(label);
    container.appendChild(item);
  }
}

/**
 * Convert a legacy dataset object to legendData format.
 */
function datasetToLegendData(dataset, year) {
  if (!dataset || dataset.type === 'none') {
    return { type: 'none' };
  }

  const title = `${dataset.name}${year ? ` (${year})` : ''}`;

  if (dataset.type === 'classified' && dataset.colormap) {
    const entries = Object.entries(dataset.colormap).map(([val, info]) => ({
      value: Number(val),
      color: info.color,
      label: info.label,
    }));
    return { type: 'classified', title, entries };
  }

  if (dataset.type === 'continuous' && dataset.legend) {
    return {
      type: 'continuous',
      title,
      palette: dataset.legend.palette,
      min: dataset.legend.min,
      max: dataset.legend.max,
      unit: dataset.legend.unit || '',
    };
  }

  return { type: 'none' };
}
