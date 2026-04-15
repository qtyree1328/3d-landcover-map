// UI controls wiring — multi-source location search, dataset picker, stepped workflow
import { DATASETS, getDataset } from '../data/datasets.js';
import { SATELLITE_DATASETS, getSatelliteDataset } from '../data/satellite.js';
import { checkGEEAvailability, fetchGEESatelliteScenes, fetchGEERaster } from '../data/gee.js';
import { loadUploadedRaster } from '../data/custom-raster.js';
import { PALETTES, PALETTE_NAMES, paletteGradientCSS } from '../viz/palettes.js';

const ANNUAL_DATASETS = DATASETS.filter((dataset) => Array.isArray(dataset.years) && dataset.years.length > 0);
const MAX_SATELLITE_PREVIEWS = 12;

let searchTimeout = null;
let locationSelectedCallback = null;
let selectedBbox = null;
let selectedBoundaryMethod = 'nominatim';
let selectedSatelliteScene = null;
let activeDatasetMode = 'annual';
let activeSourceMode = 'api'; // 'upload' or 'api'
let previewBatchToken = 0;
let selectedCustomRaster = null;

// Upload-path boundary state
let uploadSelectedBbox = null;
let uploadBoundaryMethod = 'nominatim';
let uploadBoundaryGeoJSON = null;
let uploadSearchTimeout = null;

export function initControls({
  onGenerate, onDatasetChange, onZScaleChange, onBaseDepthChange,
  onYPositionChange, onRenderModeChange, onExport, onCameraPreset,
  onToggleTitle, onToggleLegend, onLocationSelected, onShadowOffsetChange,
}) {
  const datasetSelect = document.getElementById('dataset-select');
  const yearSelect = document.getElementById('year-select');
  const annualFields = document.getElementById('annual-dataset-fields');
  const satelliteFields = document.getElementById('satellite-dataset-fields');
  const datasetModeButtons = document.querySelectorAll('.dataset-mode-btn');
  const satelliteDatasetSelect = document.getElementById('satellite-dataset-select');
  const satelliteDateField = document.getElementById('satellite-date-field');
  const satelliteDateInput = document.getElementById('satellite-date-input');
  const satelliteMonthField = document.getElementById('satellite-month-field');
  const satelliteMonthInput = document.getElementById('satellite-month-input');
  const satelliteRangeField = document.getElementById('satellite-range-field');
  const satelliteRangeSelect = document.getElementById('satellite-range-select');
  const satelliteWindowInfo = document.getElementById('satellite-window-info');
  const satelliteVisSelect = document.getElementById('satellite-vis-select');
  const satelliteCloudField = document.getElementById('satellite-cloud-field');
  const satelliteCloudInput = document.getElementById('satellite-cloud-input');
  const satelliteSortSelect = document.getElementById('satellite-sort-select');
  const satelliteMaxResultsInput = document.getElementById('satellite-max-results');
  const satelliteSelectorBtn = document.getElementById('btn-open-satellite-selector');
  const satelliteSelectionInfo = document.getElementById('satellite-selection-info');
  const satelliteModal = document.getElementById('satellite-modal');
  const satelliteModalSummary = document.getElementById('satellite-modal-summary');
  const satelliteModalStatus = document.getElementById('satellite-modal-status');
  const satelliteResults = document.getElementById('satellite-results');
  const satelliteModalApply = document.getElementById('satellite-modal-apply');
  const satelliteModalClose = document.getElementById('satellite-modal-close');
  const satelliteModalCancel = document.getElementById('satellite-modal-cancel');
  const customRasterInput = document.getElementById('custom-raster-input');
  const customRasterStatus = document.getElementById('custom-raster-status');
  const customBoundsModeSelect = document.getElementById('custom-bounds-mode-select');
  const customManualBoundsRow = document.getElementById('custom-manual-bounds-row');
  const customBoundsXMinInput = document.getElementById('custom-bounds-xmin');
  const customBoundsYMinInput = document.getElementById('custom-bounds-ymin');
  const customBoundsXMaxInput = document.getElementById('custom-bounds-xmax');
  const customBoundsYMaxInput = document.getElementById('custom-bounds-ymax');
  const uploadBoundaryFields = document.getElementById('upload-boundary-fields');

  // Satellite RGB band/color and NDVI palette controls
  const satBandR = document.getElementById('sat-band-r');
  const satBandG = document.getElementById('sat-band-g');
  const satBandB = document.getElementById('sat-band-b');
  const satColorR = document.getElementById('sat-color-r');
  const satColorG = document.getElementById('sat-color-g');
  const satColorB = document.getElementById('sat-color-b');
  const satRgbControls = document.getElementById('satellite-rgb-controls');
  const satNdviControls = document.getElementById('satellite-ndvi-controls');
  const satNdviPalette = document.getElementById('sat-ndvi-palette');
  const satNdviPalettePreview = document.getElementById('sat-ndvi-palette-preview');
  const demSourceSelect = document.getElementById('dem-source-select');

  let satelliteModalResults = [];
  let modalSelectedSceneId = null;
  let geeProxyAvailable = false;

  // --- Source mode switching ---
  function setSourceMode(mode) {
    activeSourceMode = mode;
    document.querySelectorAll('.source-mode-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.source === mode);
    });
    // Show/hide upload vs API steps
    document.querySelectorAll('.step.source-upload').forEach(el => {
      el.classList.toggle('hidden-step', mode !== 'upload');
    });
    document.querySelectorAll('.step.source-api').forEach(el => {
      el.classList.toggle('hidden-step', mode !== 'api');
    });
    // Toggle generate buttons in DEM step
    document.querySelectorAll('.source-upload-btn').forEach(el => {
      el.style.display = mode === 'upload' ? '' : 'none';
    });
    document.querySelectorAll('.source-api-btn').forEach(el => {
      el.style.display = mode === 'api' ? '' : 'none';
    });
    // Update step numbers
    renumberVisibleSteps();
    // Open the first step of the active mode
    if (mode === 'upload') {
      const uploadStep = document.querySelector('.step[data-step="upload-config"]');
      if (uploadStep) {
        uploadStep.classList.add('active', 'open');
      }
    } else {
      const locationStep = document.querySelector('.step[data-step="find-location"]');
      if (locationStep) {
        locationStep.classList.add('active', 'open');
      }
    }
  }

  document.querySelectorAll('.source-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => setSourceMode(btn.dataset.source));
  });

  function setSatelliteSelectionInfo(message, status = null) {
    satelliteSelectionInfo.textContent = message;
    satelliteSelectionInfo.classList.remove('status-success', 'status-error', 'status-warn');
    if (status) {
      satelliteSelectionInfo.classList.add(`status-${status}`);
      satelliteSelectionInfo.classList.remove('hint');
    } else {
      satelliteSelectionInfo.classList.add('hint');
    }
  }

  function clearSelectedSatelliteScene(message = 'Compositing uses date/cloud filters. Tile preview selection is optional.') {
    selectedSatelliteScene = null;
    modalSelectedSceneId = null;
    setSatelliteSelectionInfo(message, null);
  }

  function setCustomRasterStatus(message, status = null) {
    customRasterStatus.textContent = message;
    customRasterStatus.classList.remove('status-success', 'status-error', 'status-warn', 'status-loading');
    customRasterStatus.classList.add('hint');
    if (status) {
      customRasterStatus.classList.add(`status-${status}`);
      customRasterStatus.classList.remove('hint');
    }
  }

  function setDatasetMode(mode) {
    if (mode === 'satellite') {
      activeDatasetMode = 'satellite';
    } else {
      activeDatasetMode = 'annual';
    }
    datasetModeButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === activeDatasetMode);
    });
    annualFields.style.display = activeDatasetMode === 'annual' ? 'block' : 'none';
    satelliteFields.style.display = activeDatasetMode === 'satellite' ? 'block' : 'none';
  }

  function updateCustomBoundsFieldVisibility() {
    const mode = customBoundsModeSelect.value;
    customManualBoundsRow.classList.toggle('hidden', mode !== 'manual');
    uploadBoundaryFields.classList.toggle('hidden', mode !== 'custom');
    // Initialize upload map when custom boundary is first shown
    if (mode === 'custom' && !uploadLeafletMap) {
      initUploadMapPreview();
    }
  }

  function parseCustomManualBounds() {
    const xmin = parseOptionalNumber(customBoundsXMinInput.value);
    const ymin = parseOptionalNumber(customBoundsYMinInput.value);
    const xmax = parseOptionalNumber(customBoundsXMaxInput.value);
    const ymax = parseOptionalNumber(customBoundsYMaxInput.value);
    if ([xmin, ymin, xmax, ymax].some((v) => v === null)) return null;
    if (!(xmax > xmin && ymax > ymin)) return null;
    return [xmin, ymin, xmax, ymax];
  }

  function getCustomOutputBbox() {
    if (!selectedCustomRaster) {
      throw new Error('Upload a custom raster first.');
    }

    const boundsMode = customBoundsModeSelect.value;
    if (boundsMode === 'custom') {
      if (!uploadSelectedBbox) {
        throw new Error('Search/select a location first to clip custom raster to custom boundary.');
      }
      return uploadSelectedBbox;
    }

    if (boundsMode === 'manual') {
      const manual = parseCustomManualBounds();
      if (!manual) {
        throw new Error('Manual bounds are invalid. Make sure xmin<xmax and ymin<ymax.');
      }
      return manual;
    }

    // raster bounds
    if (Array.isArray(selectedCustomRaster.bounds) && selectedCustomRaster.bounds.length === 4) {
      return [...selectedCustomRaster.bounds];
    }
    throw new Error('Uploaded raster has no georeferenced bounds. Use custom boundary or manual bounds.');
  }

  function updateSatelliteCloudFieldVisibility() {
    const satelliteDataset = getSatelliteDataset(satelliteDatasetSelect.value);
    const supportsCloud = Boolean(satelliteDataset && satelliteDataset.supportsCloudFilter);
    satelliteCloudField.classList.toggle('hidden', !supportsCloud);
    satelliteCloudInput.disabled = !supportsCloud;
    if (!supportsCloud) {
      satelliteCloudInput.value = '';
    } else if (!satelliteCloudInput.value) {
      satelliteCloudInput.value = '30';
    }
  }

  function updateSatelliteDateFieldVisibility() {
    const satelliteDataset = getSatelliteDataset(satelliteDatasetSelect.value);
    const isNaipMonthly = Boolean(satelliteDataset && satelliteDataset.compositeStrategy === 'naip-month-mean');
    satelliteDateField.classList.toggle('hidden', isNaipMonthly);
    satelliteRangeField.classList.toggle('hidden', isNaipMonthly);
    satelliteMonthField.classList.toggle('hidden', !isNaipMonthly);

    // Populate range options from dataset if available
    if (satelliteDataset && satelliteDataset.dateRangeOptions && !isNaipMonthly) {
      const currentVal = satelliteRangeSelect.value;
      satelliteRangeSelect.innerHTML = '';
      for (const days of satelliteDataset.dateRangeOptions) {
        const opt = document.createElement('option');
        opt.value = String(days);
        opt.textContent = days >= 365 ? `${Math.round(days / 365)} year${days >= 730 ? 's' : ''}` : days >= 60 ? `${days} days (${Math.round(days / 30)} months)` : `${days} days`;
        if (String(days) === currentVal) opt.selected = true;
        satelliteRangeSelect.appendChild(opt);
      }
      if (!satelliteRangeSelect.value && satelliteDataset.defaultDateRangeDays) {
        satelliteRangeSelect.value = String(satelliteDataset.defaultDateRangeDays);
      }
    }
  }

  function supportsPreviewSelection(dataset) {
    return Boolean(dataset && dataset.compositeStrategy !== 'naip-month-mean');
  }

  function updateSatellitePreviewControls() {
    const satelliteDataset = getSatelliteDataset(satelliteDatasetSelect.value);
    const previewSupported = supportsPreviewSelection(satelliteDataset);
    satelliteSelectorBtn.classList.toggle('hidden', !previewSupported);
    satelliteSelectionInfo.classList.toggle('hidden', !previewSupported);

    if (!previewSupported) {
      satelliteSelectorBtn.disabled = true;
      selectedSatelliteScene = null;
      modalSelectedSceneId = null;
      return;
    }

    satelliteSelectorBtn.disabled = !geeProxyAvailable;
    if (!geeProxyAvailable) {
      setSatelliteSelectionInfo('GEE proxy unavailable.', 'error');
    } else if (!selectedSatelliteScene) {
      setSatelliteSelectionInfo('Compositing uses date/cloud filters. Tile preview selection is optional.', null);
    }
  }

  function applySatelliteDateDefaults(dataset) {
    if (!dataset) return;
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0));
    satelliteDateInput.value = formatDateInput(today);
    satelliteMonthInput.value = formatMonthInput(today);
  }

  function populateSatelliteBandDropdowns(dataset) {
    const bands = (dataset && dataset.availableBands) || [];
    const defaults = (dataset && dataset.visualizations && dataset.visualizations.rgb && dataset.visualizations.rgb.bands) || bands.slice(0, 3);
    [satBandR, satBandG, satBandB].forEach((sel, idx) => {
      sel.innerHTML = '';
      bands.forEach(b => {
        const opt = document.createElement('option');
        opt.value = b;
        opt.textContent = b;
        if (b === defaults[idx]) opt.selected = true;
        sel.appendChild(opt);
      });
    });
  }

  function populateNdviPaletteDropdown() {
    if (satNdviPalette.children.length > 0) return; // already populated
    PALETTE_NAMES.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      if (name === 'rdylgn') opt.selected = true;
      satNdviPalette.appendChild(opt);
    });
    updateNdviPalettePreview();
  }

  function updateNdviPalettePreview() {
    satNdviPalettePreview.style.background = paletteGradientCSS(satNdviPalette.value);
  }

  function toggleSatelliteVisControls() {
    const isRgb = satelliteVisSelect.value === 'rgb';
    satRgbControls.style.display = isRgb ? '' : 'none';
    satNdviControls.style.display = isRgb ? 'none' : '';
  }

  function updateSatelliteVisOptions() {
    const dataset = getSatelliteDataset(satelliteDatasetSelect.value);
    const supportsNdvi = Boolean(dataset && dataset.ndviBands && dataset.visualizations && dataset.visualizations.ndvi);
    const ndviOpt = satelliteVisSelect.querySelector('option[value="ndvi"]');
    if (ndviOpt) {
      ndviOpt.disabled = !supportsNdvi;
    }
    if (!supportsNdvi && satelliteVisSelect.value === 'ndvi') {
      satelliteVisSelect.value = 'rgb';
    }
    populateSatelliteBandDropdowns(dataset);
    populateNdviPaletteDropdown();
    toggleSatelliteVisControls();
  }

  function getSatelliteSearchWindow() {
    const dataset = getSatelliteDataset(satelliteDatasetSelect.value);
    if (!dataset) return null;

    if (dataset.compositeStrategy === 'naip-month-mean') {
      const monthDate = parseMonthInput(satelliteMonthInput.value) || parseDateInput(satelliteDateInput.value) || new Date();
      const anchorDate = new Date(Date.UTC(monthDate.getUTCFullYear(), 6, 1)); // mid-year anchor
      const start = new Date(Date.UTC(monthDate.getUTCFullYear(), 0, 1));
      const end = new Date(Date.UTC(monthDate.getUTCFullYear() + 1, 0, 1));
      return {
        strategy: dataset.compositeStrategy,
        anchorDate: formatDateInput(anchorDate),
        dateRangeDays: 365,
        startDate: formatDateInput(start),
        endDate: formatDateInput(end),
        label: `NAIP full-year mosaic: ${monthDate.getUTCFullYear()}`,
      };
    }

    const anchorDate = parseDateInput(satelliteDateInput.value) || new Date();
    const anchorDateIso = formatDateInput(anchorDate);
    const rangeDays = parseInt(satelliteRangeSelect.value, 10) || 90;
    const halfDays = Math.round(rangeDays / 2);
    const start = addDays(anchorDate, -halfDays);
    const end = addDays(anchorDate, halfDays);
    return {
      strategy: dataset.compositeStrategy || 'sentinel-cloud-masked-median',
      anchorDate: anchorDateIso,
      dateRangeDays: rangeDays,
      startDate: formatDateInput(start),
      endDate: formatDateInput(end),
      label: `Cloud-masked median composite: ${formatDateInput(start)} to ${formatDateInput(end)} (${rangeDays} days)`,
    };
  }

  function updateSatelliteWindowInfo() {
    const windowInfo = getSatelliteSearchWindow();
    if (!windowInfo) {
      satelliteWindowInfo.textContent = '';
      return;
    }
    satelliteWindowInfo.textContent = windowInfo.label;
  }

  function setSatelliteModalStatusMessage(message, type = 'loading') {
    satelliteModalStatus.textContent = message;
    satelliteModalStatus.classList.remove('status-success', 'status-error', 'status-warn', 'status-loading');
    satelliteModalStatus.classList.add(`status-${type}`);
  }

  function openSatelliteModal() {
    satelliteModal.classList.add('open');
    satelliteModal.setAttribute('aria-hidden', 'false');
  }

  function closeSatelliteModal() {
    satelliteModal.classList.remove('open');
    satelliteModal.setAttribute('aria-hidden', 'true');
    previewBatchToken += 1;
  }

  async function drawSatellitePreview(scene, canvasEl, bbox, satelliteDataset, token) {
    if (!canvasEl || token !== previewBatchToken) return;
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
    ctx.fillStyle = '#64748b';
    ctx.font = '12px Inter';
    ctx.fillText('Loading preview...', 12, 22);

    try {
      const bitmap = await fetchGEERaster({
        assetId: scene.assetId,
        assetType: 'image',
        bbox,
        visParams: satelliteDataset.visualizations.rgb,
        width: canvasEl.width,
        height: canvasEl.height,
      });
      if (token !== previewBatchToken) {
        if (bitmap.close) bitmap.close();
        return;
      }
      ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
      ctx.drawImage(bitmap, 0, 0, canvasEl.width, canvasEl.height);
      if (bitmap.close) bitmap.close();
    } catch {
      if (token !== previewBatchToken) return;
      ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '12px Inter';
      ctx.fillText('Preview unavailable', 12, 22);
    }
  }

  function renderSatelliteResultCards(images, bbox, satelliteDataset) {
    previewBatchToken += 1;
    const token = previewBatchToken;

    satelliteResults.innerHTML = '';
    if (!images.length) {
      const empty = document.createElement('div');
      empty.className = 'sat-empty';
      empty.textContent = 'No imagery found for this date window. Try a different date or cloud threshold.';
      satelliteResults.appendChild(empty);
      satelliteModalApply.disabled = true;
      return;
    }

    images.forEach((scene, index) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'sat-image-card';
      card.dataset.assetId = scene.assetId;
      if (scene.assetId === modalSelectedSceneId) {
        card.classList.add('selected');
      }

      const previewWrap = document.createElement('div');
      previewWrap.className = 'sat-preview';
      const previewCanvas = document.createElement('canvas');
      previewCanvas.width = 320;
      previewCanvas.height = 180;
      previewWrap.appendChild(previewCanvas);

      const previewLabel = document.createElement('div');
      previewLabel.className = 'sat-preview-label';
      previewLabel.textContent = formatSceneDateShort(scene.startTime);
      previewWrap.appendChild(previewLabel);

      const meta = document.createElement('div');
      meta.className = 'sat-meta';

      const dateRow = document.createElement('div');
      dateRow.className = 'sat-meta-row';
      dateRow.textContent = `Date: ${formatSceneDateLong(scene.startTime)}`;
      meta.appendChild(dateRow);

      const cloudRow = document.createElement('div');
      cloudRow.className = 'sat-meta-row';
      cloudRow.textContent = scene.cloudCover === null
        ? 'Cloud: N/A'
        : `Cloud: ${scene.cloudCover.toFixed(1)}%`;
      meta.appendChild(cloudRow);

      const idRow = document.createElement('div');
      idRow.className = 'sat-meta-row';
      idRow.textContent = trimMiddle(scene.assetId, 72);
      meta.appendChild(idRow);

      card.appendChild(previewWrap);
      card.appendChild(meta);
      card.addEventListener('click', () => {
        modalSelectedSceneId = scene.assetId;
        satelliteResults.querySelectorAll('.sat-image-card').forEach((el) => {
          el.classList.toggle('selected', el.dataset.assetId === modalSelectedSceneId);
        });
        satelliteModalApply.disabled = false;
      });

      satelliteResults.appendChild(card);

      if (index < MAX_SATELLITE_PREVIEWS) {
        drawSatellitePreview(scene, previewCanvas, bbox, satelliteDataset, token);
      } else {
        const ctx = previewCanvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
          ctx.fillStyle = '#94a3b8';
          ctx.font = '12px Inter';
          ctx.fillText('Preview skipped', 12, 22);
        }
      }
    });

    satelliteModalApply.disabled = !modalSelectedSceneId;
  }

  async function searchSatelliteImages() {
    const bbox = getSelectedBbox();
    if (!bbox) {
      setSearchStatus('Please search and select a location first.', 'error');
      return;
    }

    const satelliteDataset = getSatelliteDataset(satelliteDatasetSelect.value);
    if (!satelliteDataset) {
      setSatelliteSelectionInfo('Invalid satellite dataset selected.', 'error');
      return;
    }

    const maxResults = clampInt(satelliteMaxResultsInput.value, 1, 60, 24);
    const maxCloudCover = satelliteDataset.supportsCloudFilter
      ? parseOptionalNumber(satelliteCloudInput.value)
      : null;
    const windowInfo = getSatelliteSearchWindow();
    if (!windowInfo) {
      setSatelliteSelectionInfo('Could not build search window from selected date.', 'error');
      return;
    }
    const sortBy = satelliteSortSelect.value || 'date_desc';

    openSatelliteModal();
    satelliteModalResults = [];
    modalSelectedSceneId = selectedSatelliteScene ? selectedSatelliteScene.assetId : null;
    satelliteModalSummary.textContent = `${satelliteDataset.name} | ${windowInfo.startDate} to ${windowInfo.endDate}`;
    setSatelliteModalStatusMessage('Finding imagery tiles...', 'loading');
    satelliteResults.innerHTML = '';
    satelliteModalApply.disabled = true;

    try {
      const requestBase = {
        collectionId: satelliteDataset.collectionId,
        bbox,
        maxResults,
        maxCloudCover,
        cloudProperty: satelliteDataset.cloudProperty,
        sortBy,
      };

      const response = await fetchGEESatelliteScenes({
        ...requestBase,
        startDate: windowInfo.startDate,
        endDate: windowInfo.endDate,
      });

      satelliteModalResults = Array.isArray(response.images) ? response.images : [];
      setSatelliteModalStatusMessage(
        `Found ${satelliteModalResults.length} image${satelliteModalResults.length === 1 ? '' : 's'}.`,
        satelliteModalResults.length ? 'success' : 'warn'
      );

      renderSatelliteResultCards(satelliteModalResults, bbox, satelliteDataset);
    } catch (error) {
      setSatelliteModalStatusMessage(`Failed to query imagery: ${error.message}`, 'error');
      satelliteResults.innerHTML = '';
      const errorEl = document.createElement('div');
      errorEl.className = 'sat-empty';
      errorEl.textContent = 'Could not fetch imagery from the GEE proxy.';
      satelliteResults.appendChild(errorEl);
      satelliteModalApply.disabled = true;
    }
  }

  locationSelectedCallback = (bbox, displayName, geojsonBounds) => {
    clearSelectedSatelliteScene('Location changed. Compositing will use this area.');
    if (onLocationSelected) {
      onLocationSelected(bbox, displayName, geojsonBounds);
    }
  };

  // --- Step accordion ---
  document.querySelectorAll('.step-header').forEach(header => {
    header.addEventListener('click', () => {
      const step = header.parentElement;
      if (step.classList.contains('disabled')) return;
      step.classList.toggle('open');
    });
  });

  // --- Location source toggle (Search vs GeoJSON) ---
  document.querySelectorAll('#location-source-row .method-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#location-source-row .method-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const src = btn.dataset.source;
      const searchFields = document.getElementById('location-search-fields');
      const geojsonFields = document.getElementById('location-geojson-fields');
      if (src === 'geojson') {
        searchFields.classList.add('hidden');
        geojsonFields.classList.remove('hidden');
      } else {
        searchFields.classList.remove('hidden');
        geojsonFields.classList.add('hidden');
      }
    });
  });

  // --- GeoJSON file upload ---
  const geojsonInput = document.getElementById('geojson-upload-input');
  const geojsonStatus = document.getElementById('geojson-upload-status');
  if (geojsonInput) {
    geojsonInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      geojsonStatus.textContent = 'Reading file...';
      geojsonStatus.className = 'status-loading';
      try {
        const text = await file.text();
        const geojson = JSON.parse(text);
        const { geometry, name } = extractGeometryFromGeoJSON(geojson);
        if (!geometry) {
          geojsonStatus.textContent = 'No polygon geometry found in file.';
          geojsonStatus.className = 'status-error';
          return;
        }
        const coords = extractAllCoords(geometry);
        if (coords.length === 0) {
          geojsonStatus.textContent = 'Could not extract coordinates from geometry.';
          geojsonStatus.className = 'status-error';
          return;
        }
        const lngs = coords.map(c => c[0]);
        const lats = coords.map(c => c[1]);
        const bbox = [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
        const displayName = name || file.name.replace(/\.(geo)?json$/i, '');

        selectedBbox = bbox;
        document.getElementById('map-title').textContent = displayName;
        markStepCompleted('find-location');
        openStep('choose-dataset');
        openStep('dem');
        geojsonStatus.textContent = `Loaded: ${displayName} (${coords.length} vertices)`;
        geojsonStatus.className = 'status-success';

        if (locationSelectedCallback) {
          locationSelectedCallback(bbox, displayName, geometry);
        }
      } catch (err) {
        console.error('GeoJSON parse error:', err);
        geojsonStatus.textContent = 'Invalid GeoJSON file: ' + err.message;
        geojsonStatus.className = 'status-error';
      }
    });
  }

  // --- Boundary method buttons (API path) ---
  document.querySelectorAll('#api-method-row .method-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#api-method-row .method-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedBoundaryMethod = btn.dataset.method;
    });
  });

  // --- Boundary method buttons (Upload path) ---
  document.querySelectorAll('#upload-method-row .method-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#upload-method-row .method-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      uploadBoundaryMethod = btn.dataset.method;
    });
  });

  // --- Populate annual dataset select (all datasets, including basemaps) ---
  DATASETS.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.name;
    datasetSelect.appendChild(opt);
  });

  // --- Populate satellite dataset select ---
  SATELLITE_DATASETS.forEach((dataset) => {
    const opt = document.createElement('option');
    opt.value = dataset.id;
    opt.textContent = dataset.name;
    satelliteDatasetSelect.appendChild(opt);
  });

  updateCustomBoundsFieldVisibility();
  setCustomRasterStatus('No raster uploaded.', null);

  applySatelliteDateDefaults(getSatelliteDataset(satelliteDatasetSelect.value));
  updateSatelliteDateFieldVisibility();
  updateSatelliteCloudFieldVisibility();
  updateSatelliteVisOptions();
  updateSatelliteWindowInfo();
  updateSatellitePreviewControls();
  clearSelectedSatelliteScene();

  // GEE support removed — satellite selector is permanently disabled.
  geeProxyAvailable = false;
  updateSatellitePreviewControls();

  // Update year options when dataset changes
  datasetSelect.addEventListener('change', () => {
    updateYearSelect(datasetSelect.value);
    if (onDatasetChange) onDatasetChange(datasetSelect.value);
  });

  satelliteDatasetSelect.addEventListener('change', () => {
    updateSatelliteDateFieldVisibility();
    updateSatelliteCloudFieldVisibility();
    updateSatellitePreviewControls();
    applySatelliteDateDefaults(getSatelliteDataset(satelliteDatasetSelect.value));
    updateSatelliteVisOptions();
    updateSatelliteWindowInfo();
    clearSelectedSatelliteScene('Dataset changed. Compositing will use date/cloud filters.');
  });

  satelliteDateInput.addEventListener('change', () => {
    updateSatelliteWindowInfo();
    clearSelectedSatelliteScene('Date changed. Compositing window updated.');
  });

  satelliteRangeSelect.addEventListener('change', () => {
    updateSatelliteWindowInfo();
    clearSelectedSatelliteScene('Composite window changed.');
  });

  satelliteMonthInput.addEventListener('change', () => {
    updateSatelliteWindowInfo();
    clearSelectedSatelliteScene('Year changed. Compositing window updated.');
  });

  customBoundsModeSelect.addEventListener('change', () => {
    updateCustomBoundsFieldVisibility();
  });

  customRasterInput.addEventListener('change', async () => {
    const file = customRasterInput.files && customRasterInput.files[0];
    if (!file) {
      selectedCustomRaster = null;
      setCustomRasterStatus('No raster uploaded.', null);
      return;
    }

    setCustomRasterStatus('Reading raster file...', 'loading');
    try {
      selectedCustomRaster = await loadUploadedRaster(file);
      const hasBounds = Array.isArray(selectedCustomRaster.bounds) && selectedCustomRaster.bounds.length === 4;
      if (hasBounds) {
        const [xmin, ymin, xmax, ymax] = selectedCustomRaster.bounds;
        setCustomRasterStatus(
          `Loaded ${selectedCustomRaster.name} (${selectedCustomRaster.width}x${selectedCustomRaster.height}) | Bounds: ${xmin.toFixed(5)}, ${ymin.toFixed(5)}, ${xmax.toFixed(5)}, ${ymax.toFixed(5)}`,
          'success'
        );
        // Show raster bounds on upload map preview
        if (customBoundsModeSelect.value === 'raster') {
          showRasterBoundsOnMap(selectedCustomRaster.bounds);
        }
      } else {
        setCustomRasterStatus(
          `Loaded ${selectedCustomRaster.name} (${selectedCustomRaster.width}x${selectedCustomRaster.height}) | No georeferenced bounds found.`,
          'warn'
        );
        if (customBoundsModeSelect.value === 'raster') {
          setCustomRasterStatus('Raster has no embedded bounds. Choose custom boundary or manual bounds.', 'warn');
        }
      }
    } catch (error) {
      selectedCustomRaster = null;
      setCustomRasterStatus(`Failed to read raster: ${error.message}`, 'error');
    }
  });

  satelliteVisSelect.addEventListener('change', () => {
    toggleSatelliteVisControls();
    clearSelectedSatelliteScene('Visualization changed. Compositing will use the new mode.');
  });

  satNdviPalette.addEventListener('change', () => {
    updateNdviPalettePreview();
  });

  satelliteCloudInput.addEventListener('input', () => {
    clearSelectedSatelliteScene('Cloud filter changed. Compositing will use this threshold.');
  });

  satelliteSortSelect.addEventListener('change', () => {
    clearSelectedSatelliteScene('Sort changed for tile preview.');
  });

  satelliteMaxResultsInput.addEventListener('input', () => {
    clearSelectedSatelliteScene('Max tiles changed for tile preview.');
  });

  datasetModeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      setDatasetMode(btn.dataset.mode);
    });
  });
  setDatasetMode('annual');

  satelliteSelectorBtn.addEventListener('click', () => {
    const satelliteDataset = getSatelliteDataset(satelliteDatasetSelect.value);
    if (!supportsPreviewSelection(satelliteDataset)) return;
    searchSatelliteImages();
  });

  satelliteModalApply.addEventListener('click', () => {
    if (!modalSelectedSceneId) return;
    const selected = satelliteModalResults.find((scene) => scene.assetId === modalSelectedSceneId);
    if (!selected) return;
    selectedSatelliteScene = selected;
    setSatelliteSelectionInfo(
      `Preview tile selected: ${formatSceneDateLong(selected.startTime)} | ${selected.cloudCover === null ? 'cloud n/a' : `cloud ${selected.cloudCover.toFixed(1)}%`} (optional)`,
      'success'
    );
    closeSatelliteModal();
  });

  satelliteModalClose.addEventListener('click', closeSatelliteModal);
  satelliteModalCancel.addEventListener('click', closeSatelliteModal);
  satelliteModal.addEventListener('click', (event) => {
    if (event.target === satelliteModal) {
      closeSatelliteModal();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && satelliteModal.classList.contains('open')) {
      closeSatelliteModal();
    }
  });

  // Initialize year select
  updateYearSelect(DATASETS[0].id);

  // --- API path: Location search ---
  const searchInput = document.getElementById('search-input');
  const searchResults = document.getElementById('search-results');

  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const query = searchInput.value.trim();
    if (query.length < 3) {
      searchResults.style.display = 'none';
      return;
    }
    searchTimeout = setTimeout(() => searchLocation(query, searchResults, searchInput, 'api'), 400);
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(searchTimeout);
      const query = searchInput.value.trim();
      if (query.length >= 2) {
        searchResults.style.display = 'none';
        generateBounds(query, 'api');
      }
    }
  });

  searchInput.addEventListener('focus', () => {
    if (searchResults.children.length > 0) {
      searchResults.style.display = 'block';
    }
  });

  document.addEventListener('click', (e) => {
    if (!searchResults.contains(e.target) && e.target !== searchInput) {
      searchResults.style.display = 'none';
    }
  });

  // --- Upload path: Location search ---
  const uploadSearchInput = document.getElementById('upload-search-input');
  const uploadSearchResults = document.getElementById('upload-search-results');

  uploadSearchInput.addEventListener('input', () => {
    clearTimeout(uploadSearchTimeout);
    const query = uploadSearchInput.value.trim();
    if (query.length < 3) {
      uploadSearchResults.style.display = 'none';
      return;
    }
    uploadSearchTimeout = setTimeout(() => searchLocation(query, uploadSearchResults, uploadSearchInput, 'upload'), 400);
  });

  uploadSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(uploadSearchTimeout);
      const query = uploadSearchInput.value.trim();
      if (query.length >= 2) {
        uploadSearchResults.style.display = 'none';
        generateBounds(query, 'upload');
      }
    }
  });

  uploadSearchInput.addEventListener('focus', () => {
    if (uploadSearchResults.children.length > 0) {
      uploadSearchResults.style.display = 'block';
    }
  });

  document.addEventListener('click', (e) => {
    if (!uploadSearchResults.contains(e.target) && e.target !== uploadSearchInput) {
      uploadSearchResults.style.display = 'none';
    }
  });

  // --- Upload path: Generate button ---
  document.getElementById('btn-generate-upload').addEventListener('click', () => {
    const zScale = parseFloat(document.getElementById('zscale-slider').value);

    try {
      const customBbox = getCustomOutputBbox();
      const useBoundaryMask = customBoundsModeSelect.value === 'custom';
      const boundaryGeoJSON = useBoundaryMask ? uploadBoundaryGeoJSON : null;

      // Notify main of location for map preview
      if (onLocationSelected) {
        onLocationSelected(customBbox, selectedCustomRaster?.name || 'Custom Raster', boundaryGeoJSON);
      }

      openStep('visualization');
      openStep('adjust-view');
      onGenerate({
        mode: 'custom',
        bbox: customBbox,
        customRaster: selectedCustomRaster,
        useBoundaryMask,
        zScale,
        demMode: demSourceSelect.value || 'auto',
      });
    } catch (error) {
      setCustomRasterStatus(error.message, 'error');
    }
  });

  // --- API path: Generate button ---
  document.getElementById('btn-generate').addEventListener('click', () => {
    const zScale = parseFloat(document.getElementById('zscale-slider').value);
    const cloudThreshold = parseOptionalNumber(satelliteCloudInput.value);

    const bbox = getSelectedBbox();
    if (!bbox) {
      setSearchStatus('Please search and select a location first.', 'error');
      return;
    }

    if (activeDatasetMode === 'satellite') {
      const windowInfo = getSatelliteSearchWindow();
      if (!windowInfo) {
        setSatelliteSelectionInfo('Invalid date for satellite compositing.', 'error');
        openStep('choose-dataset');
        return;
      }
      openStep('visualization');
      openStep('adjust-view');

      const visMode = satelliteVisSelect.value || 'rgb';
      const generateParams = {
        mode: 'satellite',
        bbox,
        satelliteDatasetId: satelliteDatasetSelect.value,
        satelliteSceneId: selectedSatelliteScene ? selectedSatelliteScene.assetId : null,
        satelliteSceneDate: windowInfo.anchorDate,
        satelliteAnchorDate: windowInfo.anchorDate,
        satelliteWindowStart: windowInfo.startDate,
        satelliteWindowEnd: windowInfo.endDate,
        satelliteDateRangeDays: windowInfo.dateRangeDays || 90,
        satelliteMaxCloudCover: cloudThreshold,
        satelliteVisMode: visMode,
        zScale,
        demMode: demSourceSelect.value || 'auto',
      };

      if (visMode === 'rgb') {
        generateParams.satelliteRgbBands = [satBandR.value, satBandG.value, satBandB.value];
        generateParams.satelliteRgbColors = [satColorR.value, satColorG.value, satColorB.value];
      } else {
        generateParams.satelliteNdviPalette = satNdviPalette.value;
      }

      onGenerate(generateParams);
      return;
    }

    const datasetId = datasetSelect.value;
    const parsedYear = parseInt(yearSelect.value, 10);
    const year = Number.isFinite(parsedYear) ? parsedYear : null;
    openStep('visualization');
    openStep('adjust-view');
    onGenerate({ mode: 'annual', bbox, datasetId, year, zScale, demMode: demSourceSelect.value || 'auto' });
  });

  // --- Z-scale slider ---
  const zSlider = document.getElementById('zscale-slider');
  const zVal = document.getElementById('zscale-val');
  zSlider.addEventListener('input', () => {
    zVal.textContent = parseFloat(zSlider.value).toFixed(1);
    if (onZScaleChange) onZScaleChange(parseFloat(zSlider.value));
  });

  // --- Base depth slider ---
  const bdSlider = document.getElementById('basedepth-slider');
  const bdVal = document.getElementById('basedepth-val');
  bdSlider.addEventListener('input', () => {
    bdVal.textContent = parseFloat(bdSlider.value).toFixed(2);
    if (onBaseDepthChange) onBaseDepthChange(parseFloat(bdSlider.value));
  });

  // Y-position slider
  const ypSlider = document.getElementById('yposition-slider');
  const ypVal = document.getElementById('yposition-val');
  ypSlider.addEventListener('input', () => {
    ypVal.textContent = parseFloat(ypSlider.value).toFixed(2);
    if (onYPositionChange) onYPositionChange(parseFloat(ypSlider.value));
  });

  // Shadow offset sliders
  const sxSlider = document.getElementById('shadow-x-slider');
  const sxVal = document.getElementById('shadow-x-val');
  const szSlider = document.getElementById('shadow-z-slider');
  const szVal = document.getElementById('shadow-z-val');
  const fireShadowOffset = () => {
    if (onShadowOffsetChange) {
      onShadowOffsetChange(parseFloat(sxSlider.value), parseFloat(szSlider.value));
    }
  };
  sxSlider.addEventListener('input', () => {
    sxVal.textContent = parseFloat(sxSlider.value).toFixed(2);
    fireShadowOffset();
  });
  szSlider.addEventListener('input', () => {
    szVal.textContent = parseFloat(szSlider.value).toFixed(2);
    fireShadowOffset();
  });
  // Fire initial shadow offset
  fireShadowOffset();

  // --- Camera preset buttons ---
  document.querySelectorAll('.camera-presets button').forEach(btn => {
    btn.addEventListener('click', () => {
      if (onCameraPreset) onCameraPreset(btn.dataset.preset);
    });
  });

  // --- Title toggle ---
  const titleBtn = document.getElementById('btn-toggle-title');
  titleBtn.addEventListener('click', () => {
    titleBtn.classList.toggle('active');
    if (onToggleTitle) onToggleTitle(titleBtn.classList.contains('active'));
  });

  // --- Legend toggle ---
  const legendBtn = document.getElementById('btn-toggle-legend');
  legendBtn.addEventListener('click', () => {
    legendBtn.classList.toggle('active');
    if (onToggleLegend) onToggleLegend(legendBtn.classList.contains('active'));
  });

  // --- Render mode toggle ---
  document.getElementById('btn-rasterizer').addEventListener('click', () => {
    document.getElementById('btn-rasterizer').classList.add('active');
    document.getElementById('btn-pathtracer').classList.remove('active');
    if (onRenderModeChange) onRenderModeChange('rasterizer');
  });

  document.getElementById('btn-pathtracer').addEventListener('click', () => {
    document.getElementById('btn-pathtracer').classList.add('active');
    document.getElementById('btn-rasterizer').classList.remove('active');
    if (onRenderModeChange) onRenderModeChange('pathtracer');
  });

  // --- Export button ---
  document.getElementById('btn-export').addEventListener('click', () => {
    if (onExport) onExport();
  });

  // --- Initialize source mode ---
  setSourceMode('api');
}

// --- Upload-path Leaflet map ---
let uploadLeafletMap = null;
let uploadBboxRect = null;
let uploadBoundaryLayerObj = null;

function initUploadMapPreview() {
  const mapEl = document.getElementById('upload-map-preview');
  if (!mapEl || uploadLeafletMap) return;

  uploadLeafletMap = L.map(mapEl, {
    center: [20, 0],
    zoom: 2,
    zoomControl: true,
    attributionControl: false,
  });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
  }).addTo(uploadLeafletMap);

  setTimeout(() => uploadLeafletMap.invalidateSize(), 200);
}

function showRasterBoundsOnMap(bounds) {
  // Lazy-init map
  if (!uploadLeafletMap) initUploadMapPreview();
  if (!uploadLeafletMap) return;

  uploadLeafletMap.invalidateSize();
  const [west, south, east, north] = bounds;
  const leafletBounds = L.latLngBounds(L.latLng(south, west), L.latLng(north, east));

  if (uploadBboxRect) uploadLeafletMap.removeLayer(uploadBboxRect);
  if (uploadBoundaryLayerObj) uploadLeafletMap.removeLayer(uploadBoundaryLayerObj);

  uploadBboxRect = L.rectangle(leafletBounds, {
    color: '#818cf8',
    weight: 2,
    fillColor: '#6366f1',
    fillOpacity: 0.15,
  }).addTo(uploadLeafletMap);

  uploadLeafletMap.fitBounds(leafletBounds, { padding: [15, 15] });
}

function showUploadLocationOnMap(bbox, geojsonBounds) {
  if (!uploadLeafletMap) initUploadMapPreview();
  if (!uploadLeafletMap) return;

  uploadLeafletMap.invalidateSize();
  const [west, south, east, north] = bbox;
  const leafletBounds = L.latLngBounds(L.latLng(south, west), L.latLng(north, east));

  if (uploadBboxRect) uploadLeafletMap.removeLayer(uploadBboxRect);
  if (uploadBoundaryLayerObj) uploadLeafletMap.removeLayer(uploadBoundaryLayerObj);

  if (geojsonBounds) {
    uploadBoundaryLayerObj = L.geoJSON(geojsonBounds, {
      style: { color: '#818cf8', weight: 2, fillColor: '#6366f1', fillOpacity: 0.15 },
    }).addTo(uploadLeafletMap);

    uploadBboxRect = L.rectangle(leafletBounds, {
      color: '#f59e0b', weight: 1, dashArray: '5,5', fillOpacity: 0,
    }).addTo(uploadLeafletMap);

    if (uploadBoundaryLayerObj.getBounds().isValid()) {
      uploadLeafletMap.fitBounds(uploadBoundaryLayerObj.getBounds(), { padding: [15, 15] });
    }
  } else {
    uploadBboxRect = L.rectangle(leafletBounds, {
      color: '#818cf8', weight: 2, fillColor: '#6366f1', fillOpacity: 0.15,
    }).addTo(uploadLeafletMap);
    uploadLeafletMap.fitBounds(leafletBounds, { padding: [15, 15] });
  }
}

// --- Step management ---

function openStep(stepName) {
  const step = document.querySelector(`.step[data-step="${stepName}"]`);
  if (step) step.classList.add('open');
}

function markStepCompleted(stepName) {
  const step = document.querySelector(`.step[data-step="${stepName}"]`);
  if (step) step.classList.add('completed');
}

function renumberVisibleSteps() {
  const visibleSteps = document.querySelectorAll('.step:not(.hidden-step):not(.disabled)');
  let num = 1;
  visibleSteps.forEach(step => {
    const numberEl = step.querySelector('.step-number');
    if (numberEl) {
      numberEl.textContent = num;
      num++;
    }
  });
}

// --- Search status helpers ---

function setSearchStatus(msg, type = 'loading') {
  const el = document.getElementById('search-status');
  el.textContent = msg;
  el.className = `status-${type}`;
}

function setUploadSearchStatus(msg, type = 'loading') {
  const el = document.getElementById('upload-search-status');
  el.textContent = msg;
  el.className = `status-${type}`;
}

// --- Year select ---

function updateYearSelect(datasetId) {
  const dataset = getDataset(datasetId);
  const yearSelect = document.getElementById('year-select');
  yearSelect.innerHTML = '';

  if (dataset && dataset.years) {
    dataset.years.forEach(y => {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = y;
      if (y === dataset.years[dataset.years.length - 1]) opt.selected = true;
      yearSelect.appendChild(opt);
    });
    yearSelect.disabled = false;
  } else {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'N/A';
    yearSelect.appendChild(opt);
    yearSelect.disabled = true;
  }
}

function formatDateInput(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatMonthInput(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function parseDateInput(dateText) {
  if (!dateText) return null;
  const parsed = new Date(`${dateText}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function parseMonthInput(monthText) {
  if (!monthText) return null;
  const match = monthText.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
  return new Date(Date.UTC(year, month - 1, 15, 12, 0, 0));
}

function addDays(date, offsetDays) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d;
}

function parseOptionalNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampInt(value, min, max, fallback) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function formatSceneDateLong(timestamp) {
  if (!timestamp) return 'Unknown date';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
}

function formatSceneDateShort(timestamp) {
  if (!timestamp) return 'Unknown';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
}

function trimMiddle(text, maxLen) {
  if (!text || text.length <= maxLen) return text;
  const front = Math.ceil((maxLen - 3) / 2);
  const back = Math.floor((maxLen - 3) / 2);
  return `${text.slice(0, front)}...${text.slice(text.length - back)}`;
}

// --- Nominatim quick search (dropdown results) ---
// `context` is 'api' or 'upload' to route results to the right path

async function searchLocation(query, resultsEl, inputEl, context) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=8&addressdetails=1&extratags=1&bounded=0&polygon_geojson=1&polygon_threshold=0.0001`;
    const resp = await fetch(url, {
      headers: { 'Accept-Language': 'en' }
    });
    const results = await resp.json();

    resultsEl.innerHTML = '';
    if (results.length === 0) {
      resultsEl.style.display = 'none';
      return;
    }

    for (const r of results) {
      const item = document.createElement('div');
      item.className = 'result-item';

      const name = document.createElement('span');
      name.className = 'result-name';
      name.textContent = r.display_name.length > 55 ? r.display_name.slice(0, 55) + '...' : r.display_name;

      const type = document.createElement('span');
      type.className = 'result-type';
      type.textContent = r.type;

      item.appendChild(name);
      item.appendChild(type);

      item.addEventListener('click', () => {
        const bbox = r.boundingbox; // [south, north, west, east]
        const parsedBbox = [
          parseFloat(bbox[2]), // xmin (west)
          parseFloat(bbox[0]), // ymin (south)
          parseFloat(bbox[3]), // xmax (east)
          parseFloat(bbox[1]), // ymax (north)
        ];
        inputEl.value = r.display_name.length > 50 ? r.display_name.slice(0, 50) + '...' : r.display_name;
        resultsEl.style.display = 'none';

        const displayName = r.name || r.display_name.split(',')[0];
        const geojsonBounds = r.geojson || null;
        const hasPolygon = geojsonBounds && geojsonBounds.type !== 'Point';

        if (context === 'upload') {
          uploadSelectedBbox = parsedBbox;
          uploadBoundaryGeoJSON = hasPolygon ? geojsonBounds : null;
          setUploadSearchStatus(
            `Selected: ${displayName}` + (hasPolygon ? ' (polygon)' : ' (bbox only)'),
            hasPolygon ? 'success' : 'warn'
          );
          showUploadLocationOnMap(parsedBbox, hasPolygon ? geojsonBounds : null);
        } else {
          selectedBbox = parsedBbox;
          document.getElementById('map-title').textContent = displayName;
          markStepCompleted('find-location');
          openStep('choose-dataset');
          openStep('dem');
          setSearchStatus(
            `Selected: ${displayName}` + (hasPolygon ? ' (polygon)' : ' (bbox only)'),
            hasPolygon ? 'success' : 'warn'
          );
          if (locationSelectedCallback) {
            locationSelectedCallback(parsedBbox, displayName, hasPolygon ? geojsonBounds : null);
          }
        }
      });

      resultsEl.appendChild(item);
    }

    resultsEl.style.display = 'block';
  } catch (e) {
    console.error('Search failed:', e);
    resultsEl.style.display = 'none';
  }
}

// --- Generate Bounds (multi-source) ---
// `context` is 'api' or 'upload'

async function generateBounds(query, context) {
  const statusFn = context === 'upload' ? setUploadSearchStatus : setSearchStatus;
  const boundaryMethod = context === 'upload' ? uploadBoundaryMethod : selectedBoundaryMethod;

  // Check for direct coordinates input (lat,lng)
  const coordMatch = query.match(/^(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)$/);
  if (coordMatch) {
    const lat = parseFloat(coordMatch[1]);
    const lng = parseFloat(coordMatch[2]);
    const delta = 0.05;
    const bbox = [lng - delta, lat - delta, lng + delta, lat + delta];

    if (context === 'upload') {
      uploadSelectedBbox = bbox;
      uploadBoundaryGeoJSON = null;
      statusFn(`Coordinates: ${lat.toFixed(4)}, ${lng.toFixed(4)}`, 'success');
      showUploadLocationOnMap(bbox, null);
    } else {
      selectedBbox = bbox;
      document.getElementById('map-title').textContent = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      markStepCompleted('find-location');
      openStep('choose-dataset');
      openStep('dem');
      statusFn(`Coordinates: ${lat.toFixed(4)}, ${lng.toFixed(4)}`, 'success');
      if (locationSelectedCallback) {
        locationSelectedCallback(bbox, `${lat.toFixed(4)}, ${lng.toFixed(4)}`);
      }
    }
    return;
  }

  statusFn('Searching...', 'loading');

  try {
    let geojsonBounds = null;
    let note = '';

    if (boundaryMethod === 'nominatim') {
      ({ geojsonBounds, note } = await fetchNominatimBounds(query));
    } else if (boundaryMethod === 'overpass') {
      ({ geojsonBounds, note } = await fetchOverpassBounds(query));
    } else if (boundaryMethod === 'osmfr') {
      ({ geojsonBounds, note } = await fetchOsmFrBounds(query));
    }

    if (geojsonBounds) {
      const coords = extractAllCoords(geojsonBounds);
      if (coords.length > 0) {
        const lngs = coords.map(c => c[0]);
        const lats = coords.map(c => c[1]);
        const bbox = [
          Math.min(...lngs),
          Math.min(...lats),
          Math.max(...lngs),
          Math.max(...lats),
        ];

        const isFallback = note.includes('fallback') || note.includes('bbox');

        if (context === 'upload') {
          uploadSelectedBbox = bbox;
          uploadBoundaryGeoJSON = geojsonBounds;
          statusFn(note, isFallback ? 'warn' : 'success');
          showUploadLocationOnMap(bbox, geojsonBounds);
        } else {
          selectedBbox = bbox;
          document.getElementById('map-title').textContent = query;
          markStepCompleted('find-location');
          openStep('choose-dataset');
          openStep('dem');
          statusFn(note, isFallback ? 'warn' : 'success');
          if (locationSelectedCallback) {
            locationSelectedCallback(bbox, query, geojsonBounds);
          }
        }
      }
    } else {
      statusFn('No boundary data found. Try a different method.', 'error');
    }
  } catch (e) {
    console.error('Boundary search failed:', e);
    statusFn('Search failed. Try a different method.', 'error');
  }
}

// --- Nominatim with polygon geometry ---

async function fetchNominatimBounds(query) {
  const r = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&polygon_geojson=1&polygon_threshold=0.0001&q=${encodeURIComponent(query)}`,
    { headers: { 'Accept-Language': 'en' } }
  );
  const d = await r.json();

  if (d.length && d[0].geojson) {
    return { geojsonBounds: d[0].geojson, note: 'Nominatim polygon' };
  } else if (d.length && d[0].boundingbox) {
    const b = d[0].boundingbox.map(parseFloat);
    return {
      geojsonBounds: {
        type: 'Polygon',
        coordinates: [[[b[2],b[0]], [b[3],b[0]], [b[3],b[1]], [b[2],b[1]], [b[2],b[0]]]],
      },
      note: 'Nominatim bbox (no polygon available)',
    };
  }
  return { geojsonBounds: null, note: '' };
}

// --- Overpass API (admin boundary relations) ---

async function fetchOverpassBounds(query) {
  const nr = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`,
    { headers: { 'Accept-Language': 'en' } }
  );
  const nd = await nr.json();

  if (!nd.length) return { geojsonBounds: null, note: '' };

  if (nd[0].osm_type === 'relation') {
    try {
      const oq = `[out:json];relation(${nd[0].osm_id});out geom;`;
      const or = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: oq,
      });
      const od = await or.json();

      if (od.elements && od.elements.length) {
        const rel = od.elements[0];
        if (rel.members) {
          const coords = [];
          rel.members
            .filter(m => m.type === 'way' && m.role === 'outer')
            .forEach(w => {
              if (w.geometry) w.geometry.forEach(p => coords.push([p.lon, p.lat]));
            });
          if (coords.length > 2) {
            return {
              geojsonBounds: { type: 'Polygon', coordinates: [coords] },
              note: 'Overpass relation boundary',
            };
          }
        }
      }
    } catch (e) {
      console.warn('Overpass query failed:', e);
    }
  }

  // Fallback to bbox
  if (nd[0].boundingbox) {
    const b = nd[0].boundingbox.map(parseFloat);
    return {
      geojsonBounds: {
        type: 'Polygon',
        coordinates: [[[b[2],b[0]], [b[3],b[0]], [b[3],b[1]], [b[2],b[1]], [b[2],b[0]]]],
      },
      note: 'Overpass fallback (bbox)',
    };
  }
  return { geojsonBounds: null, note: '' };
}

// --- OSM.fr pre-processed polygons ---

async function fetchOsmFrBounds(query) {
  const nr = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`,
    { headers: { 'Accept-Language': 'en' } }
  );
  const nd = await nr.json();

  if (!nd.length) return { geojsonBounds: null, note: '' };

  try {
    const fr = await fetch(
      `https://polygons.openstreetmap.fr/get_geojson.py?id=${nd[0].osm_id}&params=0`
    );
    if (fr.ok) {
      const fd = await fr.json();
      if (fd.geometries && fd.geometries[0]) {
        return { geojsonBounds: fd.geometries[0], note: 'OSM.fr polygon' };
      } else if (fd.type) {
        return { geojsonBounds: fd, note: 'OSM.fr polygon' };
      }
    }
  } catch (e) {
    console.warn('OSM.fr fetch failed:', e);
  }

  // Fallback to bbox
  if (nd[0].boundingbox) {
    const b = nd[0].boundingbox.map(parseFloat);
    return {
      geojsonBounds: {
        type: 'Polygon',
        coordinates: [[[b[2],b[0]], [b[3],b[0]], [b[3],b[1]], [b[2],b[1]], [b[2],b[0]]]],
      },
      note: 'OSM.fr fallback (bbox)',
    };
  }
  return { geojsonBounds: null, note: '' };
}

// --- Extract all coordinates from GeoJSON geometry ---

function extractAllCoords(geojson) {
  const coords = [];
  function walk(arr, depth) {
    if (depth === 0) {
      coords.push(arr);
    } else {
      for (const item of arr) walk(item, depth - 1);
    }
  }

  if (geojson.type === 'Point') {
    coords.push(geojson.coordinates);
  } else if (geojson.type === 'Polygon') {
    walk(geojson.coordinates, 2);
  } else if (geojson.type === 'MultiPolygon') {
    walk(geojson.coordinates, 3);
  } else if (geojson.type === 'GeometryCollection' && geojson.geometries) {
    for (const g of geojson.geometries) coords.push(...extractAllCoords(g));
  }
  return coords;
}

// --- Extract geometry from any GeoJSON wrapper ---

function extractGeometryFromGeoJSON(geojson) {
  if (!geojson || typeof geojson !== 'object') return { geometry: null, name: null };

  // Direct geometry (Polygon, MultiPolygon, etc.)
  if (geojson.type === 'Polygon' || geojson.type === 'MultiPolygon' || geojson.type === 'GeometryCollection') {
    return { geometry: geojson, name: null };
  }

  // Feature
  if (geojson.type === 'Feature' && geojson.geometry) {
    const name = geojson.properties?.name || geojson.properties?.NAME || null;
    return { geometry: geojson.geometry, name };
  }

  // FeatureCollection — merge all geometries or use first polygon
  if (geojson.type === 'FeatureCollection' && Array.isArray(geojson.features)) {
    const polyFeatures = geojson.features.filter(f =>
      f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
    );
    if (polyFeatures.length === 0) return { geometry: null, name: null };

    // If single feature, use it directly
    if (polyFeatures.length === 1) {
      const f = polyFeatures[0];
      const name = f.properties?.name || f.properties?.NAME || null;
      return { geometry: f.geometry, name };
    }

    // Multiple polygon features — wrap as a GeometryCollection
    const name = polyFeatures[0].properties?.name || polyFeatures[0].properties?.NAME || null;
    return {
      geometry: {
        type: 'GeometryCollection',
        geometries: polyFeatures.map(f => f.geometry),
      },
      name,
    };
  }

  return { geometry: null, name: null };
}

export function getSelectedBbox() {
  return selectedBbox;
}
