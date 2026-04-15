# GEE Implementation — What Was Removed

This document records, in as much detail as I retained, every Google Earth Engine (GEE) integration that I stripped out of the original `Map_maker/3d-landcover/` app while building this GEE-free fork. It is meant as a reconstruction reference if you ever need to put GEE back in.

There are two kinds of entries below:
- **Full content known** — I read the original file or section in this session, so I can reproduce it verbatim or near-verbatim.
- **Outline only** — I deleted the file or knew it only from a structural audit. The shape is documented; the actual code is not recoverable from my context.

If iCloud Drive's *Recently Deleted* still has the deleted files, prefer those over anything reconstructed from this doc.

---

## 1. Deleted files

### 1.1 `server/gee-proxy.js`  (≈1040 lines) — **outline only**

A standalone Node.js HTTP server that authenticated to the Earth Engine REST API on behalf of the browser. Not bundled with Vite — run separately with `node server/gee-proxy.js`.

**Endpoints exposed on `http://localhost:3001`:**
- `POST /api/gee/thumbnail`  → `computePixels` returning a PNG/NPY for an asset over a bbox
- `POST /api/gee/elevation`  → `computePixels` returning an NPY array of elevation values for a DEM asset over a bbox
- `GET  /api/gee/list-images` → enumerated image IDs in a collection (Sentinel-2 SR, NAIP) filtered by bbox + date window + cloud cover

**Constants observed in the audit:**
```js
const GEE_CLOUD_URL    = 'https://gee-proxy-787413290356.us-east1.run.app';
let   geeBaseUrl       = GEE_CLOUD_URL;            // overridable for local dev
const GEE_PROJECT_PATH = 'projects/generalresearch-478019';
const GEE_API_V1       = 'https://earthengine.googleapis.com/v1';
const GEE_API_V1ALPHA  = 'https://earthengine.googleapis.com/v1alpha';
```

**Auth:**
```js
import { GoogleAuth } from 'google-auth-library';
const auth = new GoogleAuth({
  keyFile: '../service-account.json',     // sibling of the 3d-landcover dir
  scopes: ['https://www.googleapis.com/auth/earthengine.readonly'],
});
```
Service account email: `jarvis@generalresearch-478019.iam.gserviceaccount.com`.
The `service-account.json` lives one directory above `3d-landcover/` (in `Map_maker/`) and is `.gitignore`d.

**Cloud Run fallback** at `https://gee-proxy-787413290356.us-east1.run.app` — used when the local dev server isn't running so the deployed-or-shared frontend can still hit GEE through the same paths.

**Key request body shape for thumbnail/elevation (computePixels):**
```js
{
  expression: { ...EE expression graph... },
  fileFormat: 'PNG' | 'NPY',
  grid: {
    dimensions: { width, height },
    affineTransform: { ... derived from bbox ... },
    crsCode: 'EPSG:4326',
  },
  bandIds: [...],   // from visParams.bands
  visualizationOptions: { ranges: [{min, max}], palette: [...] },
}
```

---

### 1.2 `src/data/gee.js`  (≈212 lines) — **outline only**

Browser-side client for the proxy above. Replaced in this fork with a no-op stub at the same path that throws "GEE removed" if anyone calls into it.

**Exports (signatures retained from the audit + import sites):**
```js
export async function checkGEEAvailability(): Promise<boolean>
export function     isGEEAvailable(): boolean
export async function fetchGEERaster(opts): Promise<ImageBitmap>
export async function fetchGEEElevation(opts): Promise<ArrayBuffer>   // NPY buffer
export async function fetchGEESatelliteScenes(opts): Promise<Array>
export function     getGEEBaseCandidates(): string[]                 // failover list
```

**`fetchGEERaster` opts** (inferred from call sites in `main.js` and `controls.js`):
```js
{
  assetId,           // 'projects/sat-io/...' or 'GOOGLE/DYNAMICWORLD/V1' etc.
  assetType,         // 'image' | 'collection' | null
  bbox,              // [xmin, ymin, xmax, ymax]
  visParams,         // { bands, min, max, palette }
  width, height,
  year,              // optional, used by year-aware datasets
  composite,         // optional, used by satellite scene flow:
                     // { strategy, anchorDate, dateRangeDays, startDate, endDate,
                     //   visMode, cloudProperty, maxCloudCover, ndviBands }
}
```

**`fetchGEEElevation` opts:**
```js
{ assetId, bbox, width, height, band, reducer }
```

**`fetchGEESatelliteScenes` opts** (used by the satellite preview modal):
```js
{
  bbox,
  collectionId,           // 'COPERNICUS/S2_SR_HARMONIZED' | 'USDA/NAIP/DOQQ'
  startDate, endDate,
  cloudProperty,          // 'CLOUDY_PIXEL_PERCENTAGE' for S2; null for NAIP
  maxCloudCover,
  maxResults,
  sort,                   // 'date' | 'cloud-cover' | etc.
}
// → returns array of { id, date, cloudCover, thumbnailUrl, footprint, ... }
```

**Availability check:** `checkGEEAvailability()` pinged a tiny endpoint on the proxy (probably `GET /api/gee/health` or a 1×1 thumbnail) and resolved `true` on 2xx, `false` otherwise. Used to gray out GEE dataset options in the dropdown.

**Failover:** `getGEEBaseCandidates()` returned the list `[localProxy, GEE_CLOUD_URL]` in order; `fetchGEERaster` tried each in turn before throwing.

---

### 1.3 `AGENT_HANDOFF.md`, `HOW_TO_RUN.md`, `CLAUDE.md`

Project documentation files. I have **`CLAUDE.md`** verbatim from this session's reads — see Appendix A. The other two were never opened by me; their contents are unrecoverable from this session.

`CLAUDE.md` covered the full architecture, data sources, GEE auth setup, and three deployment options (Vercel serverless, Railway/Fly.io/Render, Cloud Run).

---

### 1.4 `dist/`

Build output. Not a loss — rebuild with `npm run build`.

---

## 2. Files I overwrote (originals known)

For these, I have the pre-edit content from this session's reads. They can be restored verbatim on request.

### 2.1 `src/data/datasets.js` — GEE entries removed

Four GEE-backed datasets removed from the registry. **Full original entries:**

```js
{
  id: 'gee-esri-lulc',
  name: 'ESRI LULC via GEE (10m)',
  source: 'gee',
  type: 'classified',
  nativeResolutionM: 10,
  maxResolution: 2048,
  assetId: 'projects/sat-io/open-datasets/landcover/ESRI_Global-LULC_10m_TS',
  years: [2017, 2018, 2019, 2020, 2021, 2022, 2023],
  visParams: {
    bands: ['b1'], min: 1, max: 11,
    palette: ['419bdf','397d49','88b053','7a87c6','e49635','dfc35a',
              'c4281b','a59b8f','b39fe1','a8ebff','616161','e3e2c3'],
  },
  colormap: {
    1:  { color: '#419bdf', label: 'Water' },
    2:  { color: '#397d49', label: 'Trees' },
    4:  { color: '#7a87c6', label: 'Flooded Vegetation' },
    5:  { color: '#e49635', label: 'Crops' },
    7:  { color: '#c4281b', label: 'Built Area' },
    8:  { color: '#a59b8f', label: 'Bare Ground' },
    9:  { color: '#a8ebff', label: 'Snow/Ice' },
    10: { color: '#616161', label: 'Clouds' },
    11: { color: '#e3e2c3', label: 'Rangeland' },
  },
},
{
  id: 'gee-dynamic-world',
  name: 'Dynamic World (10m)',
  source: 'gee',
  type: 'classified',
  nativeResolutionM: 10,
  maxResolution: 2048,
  assetId: 'GOOGLE/DYNAMICWORLD/V1',
  years: [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024],
  visParams: {
    bands: ['label'], min: 0, max: 8,
    palette: ['419BDF','397D49','88B053','7A87C6','E49635',
              'DFC35A','C4281B','A59B8F','B39FE1'],
  },
  colormap: {
    0: { color: '#419BDF', label: 'Water' },
    1: { color: '#397D49', label: 'Trees' },
    2: { color: '#88B053', label: 'Grass' },
    3: { color: '#7A87C6', label: 'Flooded Vegetation' },
    4: { color: '#E49635', label: 'Crops' },
    5: { color: '#DFC35A', label: 'Shrub & Scrub' },
    6: { color: '#C4281B', label: 'Built' },
    7: { color: '#A59B8F', label: 'Bare' },
    8: { color: '#B39FE1', label: 'Snow & Ice' },
  },
},
{
  id: 'gee-nlcd',
  name: 'NLCD Land Cover (US, 30m)',
  source: 'gee',
  type: 'classified',
  nativeResolutionM: 30,
  maxResolution: 2048,
  assetId: 'USGS/NLCD_RELEASES/2021_REL/NLCD',
  years: [2001, 2004, 2006, 2008, 2011, 2013, 2016, 2019, 2021],
  visParams: {
    bands: ['landcover'], min: 0, max: 95,
    palette: [
      '466b9f','d1def8','dec5c5','d99282','eb0000','ab0000',
      'b3ac9f','68ab5f','1c5f2c','b5c58f','ccb879','dfdfc2',
      'dbd83d','ab6c28','b8d9eb','6c9fb8',
    ],
  },
  colormap: {
    11: { color: '#466b9f', label: 'Open Water' },
    12: { color: '#d1def8', label: 'Perennial Ice/Snow' },
    21: { color: '#dec5c5', label: 'Developed, Open Space' },
    22: { color: '#d99282', label: 'Developed, Low Intensity' },
    23: { color: '#eb0000', label: 'Developed, Medium Intensity' },
    24: { color: '#ab0000', label: 'Developed, High Intensity' },
    31: { color: '#b3ac9f', label: 'Barren Land' },
    41: { color: '#68ab5f', label: 'Deciduous Forest' },
    42: { color: '#1c5f2c', label: 'Evergreen Forest' },
    43: { color: '#b5c58f', label: 'Mixed Forest' },
    52: { color: '#ccb879', label: 'Shrub/Scrub' },
    71: { color: '#dfdfc2', label: 'Grassland/Herbaceous' },
    81: { color: '#dbd83d', label: 'Pasture/Hay' },
    82: { color: '#ab6c28', label: 'Cultivated Crops' },
    90: { color: '#b8d9eb', label: 'Woody Wetlands' },
    95: { color: '#6c9fb8', label: 'Emergent Herbaceous Wetlands' },
  },
},
{
  id: 'gee-canopy-height',
  name: 'ETH Canopy Height (10m)',
  source: 'gee',
  type: 'continuous',
  nativeResolutionM: 10,
  maxResolution: 2048,
  assetId: 'users/nlang/ETH_GlobalCanopyHeight_2020_10m_v1',
  visParams: {
    bands: ['b1'], min: 0, max: 40,
    palette: ['f7fcf5','e5f5e0','c7e9c0','a1d99b','74c476',
              '41ab5d','238b45','006d2c','00441b'],
  },
  legend: {
    type: 'gradient', min: 0, max: 40, unit: 'm', label: 'Canopy Height',
    palette: ['#f7fcf5','#e5f5e0','#c7e9c0','#a1d99b','#74c476',
              '#41ab5d','#238b45','#006d2c','#00441b'],
  },
},
```

---

### 2.2 `src/data/satellite.js` — entire file is GEE-only

The satellite-scene workflow (Sentinel-2 + NAIP scene picker, NDVI/RGB band controls, cloud filter, date window) was a separate "Satellite Imagery" mode that depended on the GEE proxy for both listing scenes and rendering them. The dataset registry below is **full content**; the runtime code that consumed `source: 'gee-satellite-scene'` lived in `main.js` (see §2.3) and `controls.js` (preview modal, date window UI).

```js
export const SATELLITE_DATASETS = [
  {
    id: 'sentinel2-sr',
    name: 'Sentinel-2 SR Harmonized',
    source: 'gee-satellite-scene',
    type: 'none',
    nativeResolutionM: 10,
    maxResolution: 2048,
    collectionId: 'COPERNICUS/S2_SR_HARMONIZED',
    compositeStrategy: 'sentinel-cloud-masked-median',
    availableBands: ['B1','B2','B3','B4','B5','B6','B7','B8','B8A','B9','B11','B12'],
    visualizations: {
      rgb:  { bands: ['B4','B3','B2'], min: 0, max: 3000 },
      ndvi: { min: -0.2, max: 0.9,
              palette: ['8b0000','b8860b','f0e68c','9acd32','006400'] },
    },
    ndviBands: ['B8','B4'],
    cloudProperty: 'CLOUDY_PIXEL_PERCENTAGE',
    supportsCloudFilter: true,
    defaultDateRangeDays: 90,
    dateRangeOptions: [30, 60, 90, 180, 365],
  },
  {
    id: 'naip',
    name: 'USDA NAIP',
    source: 'gee-satellite-scene',
    type: 'none',
    nativeResolutionM: 0.6,
    maxResolution: 2800,
    collectionId: 'USDA/NAIP/DOQQ',
    compositeStrategy: 'naip-month-mean',
    availableBands: ['R','G','B','N'],
    visualizations: {
      rgb:  { bands: ['R','G','B'], min: 0, max: 255 },
      ndvi: { min: -0.2, max: 0.9,
              palette: ['8b0000','b8860b','f0e68c','9acd32','006400'] },
    },
    ndviBands: ['N','R'],
    cloudProperty: null,
    supportsCloudFilter: false,
    defaultDateRangeDays: 365,
    dateRangeOptions: null,
  },
];

export function getSatelliteDataset(id) {
  return SATELLITE_DATASETS.find(d => d.id === id);
}
```

Compositing strategies (`sentinel-cloud-masked-median`, `naip-month-mean`) were implemented inside the proxy — the browser only sent the strategy name + params and got back a composited PNG/bitmap.

---

### 2.3 `src/data/elevation.js` — GEE DEM modes removed

Removed the GEE-backed DEM candidate chain and the `fetchGEEElevation` import. **Full original GEE-related content:**

```js
import { fetchGEEElevation } from './gee.js';

const GEE_US_DEM_CANDIDATES = [
  { assetId: 'USGS/3DEP/1m',             band: 'elevation', reducer: 'mosaic', noData: -9999  },
  { assetId: 'USGS/3DEP/10m_collection', band: 'elevation', reducer: 'mosaic', noData: -9999  },
];

const GEE_GLOBAL_DEM_CANDIDATES = [
  { assetId: 'COPERNICUS/DEM/GLO30',     band: 'DEM',       reducer: 'mosaic', noData: -32767 },
  { assetId: 'NASA/NASADEM_HGT/001',     band: 'elevation', reducer: 'mosaic', noData: -32768 },
];

// Mode dispatch in fetchElevation():
//   'gee-1m'         → first US candidate only (3DEP 1m)
//   'gee-1m-only'    → same as above
//   'gee-10m'        → second US candidate (3DEP 10m_collection)
//   'gee-copernicus' → COPERNICUS/DEM/GLO30
//   'gee-nasadem'    → NASA/NASADEM_HGT/001
//   'gee-chain-only' → US candidates first if bbox ∩ US, else global, no Terrarium fallback
//   default 'auto'   → try fetchElevationFromGEE, on error fall back to Terrarium
```

The chain function `fetchElevationFromGEE(bbox, w, h)` walked candidates in order, calling `fetchGEEElevation({ assetId, bbox, width, height, band, reducer })`, then parsed the returned NPY buffer through `npyToElevationData` (with NPY 1.0/2.0 header parser supporting `f4`, `f8`, `i2`, `u2`, `i4`, `u4`, `i1`, `u1` dtypes). NPY parser code is preserved in this fork's git history under the original elevation.js — it was deleted along with the GEE branches but is reproducible from this session's read of the file.

The `bboxOverlapsUS()` helper used a coarse bounding box of `xmin >= -170, xmax <= -60, ymin >= 15, ymax <= 72` to decide whether to prepend the US 3DEP candidates.

---

### 2.4 `src/main.js` — GEE fetchRaster cases removed

Two `switch` arms inside `fetchRaster()`:

```js
case 'gee': {
  const { fetchGEERaster } = await import('./data/gee.js');
  const bitmap = await fetchGEERaster({
    assetId: dataset.assetId,
    bbox,
    visParams: dataset.visParams,
    width, height, year,
    assetType: options.assetType || null,
  });
  return { bitmap, isRawClassValues: false };
}
case 'gee-satellite-scene': {
  const { fetchGEERaster } = await import('./data/gee.js');
  const bitmap = await fetchGEERaster({
    assetId:   options.assetId   || dataset.collectionId,
    assetType: options.assetType || 'collection',
    bbox,
    visParams: options.visParams || (dataset.visualizations ? dataset.visualizations.rgb : null),
    width, height,
    composite: options.composite || null,
  });
  return { bitmap, isRawClassValues: false };
}
```

The `composite` object passed in for the satellite-scene path is built around line ~305 of `main.js` from the `handleGenerate` arguments and includes:

```js
{
  strategy:        dataset.compositeStrategy,    // e.g. 'sentinel-cloud-masked-median'
  anchorDate:      satelliteAnchorDate,          // 'YYYY-MM-DD'
  dateRangeDays:   satelliteDateRangeDays,       // number
  startDate:       satelliteWindowStart || null, // 'YYYY-MM-DD' or null
  endDate:         satelliteWindowEnd   || null,
  visMode:         'rgb' | 'ndvi',
  cloudProperty:   dataset.cloudProperty || null,
  maxCloudCover:   satelliteMaxCloudCover,
  ndviBands:       visMode === 'ndvi' ? dataset.ndviBands : null,
}
```

The whole `mode === 'satellite'` branch in `handleGenerate` (parameter parsing for `satelliteRgbBands`, `satelliteRgbColors`, `satelliteNdviPalette`, `satelliteAnchorDate`, etc.) was *not* deleted — it just dead-codes now because the UI no longer fires it. If you wire GEE back in, that branch is still intact in this fork.

---

### 2.5 `src/ui/controls.js` — only two surgical edits

This 1678-line file was *not* gutted. I made exactly two substitutions:

**(a)** Removed the `[GEE]` suffix in the dataset dropdown population:
```diff
- opt.textContent = d.source === 'gee' ? `${d.name} [GEE]` : d.name;
+ opt.textContent = d.name;
```

**(b)** Replaced the GEE availability check + relabel block with a hard-coded "unavailable":
```diff
- checkGEEAvailability().then(available => {
-   const options = datasetSelect.querySelectorAll('option');
-   options.forEach(opt => {
-     const ds = getDataset(opt.value);
-     if (ds && ds.source === 'gee' && !available) {
-       opt.textContent = `${ds.name} [GEE - unavailable]`;
-       opt.style.color = '#64748b';
-     }
-   });
-   geeProxyAvailable = available;
-   updateSatellitePreviewControls();
- });
+ // GEE support removed — satellite selector is permanently disabled.
+ geeProxyAvailable = false;
+ updateSatellitePreviewControls();
```

The imports at the top still reference `gee.js` (now the no-op stub) and `SATELLITE_DATASETS`, so all the satellite preview modal code, scene cards, date window helpers, NDVI palette controls, etc. are still in the file but never trigger because the UI button that selected satellite mode was removed (see §2.6).

---

### 2.6 `index.html` — four edits

**(a)** Removed the "Satellite Imagery" mode toggle button:
```diff
  <button class="dataset-mode-btn active" data-mode="annual" type="button">Annual Landcover</button>
- <button class="dataset-mode-btn" data-mode="satellite" type="button">Satellite Imagery</button>
```

**(b)** Hid the entire satellite-dataset-fields panel (kept in DOM so JS doesn't crash):
```diff
- <div id="satellite-dataset-fields">
+ <div id="satellite-dataset-fields" style="display:none" hidden>
```

**(c)** Removed the GEE-specific resolution option:
```diff
  <option value="2048">2048 px</option>
- <option value="2800">2800 px (GEE max)</option>
- <option value="4096">4096 px (tiles only)</option>
+ <option value="4096">4096 px (tile sources only)</option>
```

**(d)** Replaced the DEM source dropdown options:
```diff
  <select id="dem-source-select">
    <option value="auto" selected>Auto (best available)</option>
-   <option value="gee-1m">GEE USGS 3DEP 1m (US only)</option>
-   <option value="gee-10m">GEE USGS 3DEP 10m (US only)</option>
-   <option value="gee-copernicus">Copernicus GLO-30 (global)</option>
-   <option value="gee-nasadem">NASADEM (global)</option>
    <option value="usgs-3dep">USGS 3DEP 1m REST (US only)</option>
    <option value="terrarium">Terrarium Tiles (global)</option>
  </select>
- <div class="hint" id="dem-source-hint">Auto tries GEE high-res DEMs first, falls back to Terrarium tiles.</div>
+ <div class="hint" id="dem-source-hint">Auto uses USGS 3DEP inside the US, otherwise AWS Terrarium. Both are free and require no API key.</div>
```

**(e)** Footer attribution string:
```diff
- Elevation: AWS Terrain Tiles | Land Cover: ESRI / GEE | Inspired by Milos Popovic
+ Elevation: AWS Terrarium & USGS 3DEP | Land Cover: ESRI Sentinel-2 | Inspired by Milos Popovic
```

The big satellite preview modal (`<div id="satellite-modal">` near line 1729) is **still in the HTML** — it just isn't reachable since its trigger button is hidden.

---

### 2.7 `vite.config.js` — `/api/gee` proxy removed

```diff
  export default defineConfig({
+   base: process.env.VITE_BASE || './',
    server: {
      open: true,
-     proxy: {
-       '/api/gee': {
-         target: 'http://localhost:3001',
-         changeOrigin: true,
-       },
-     },
    },
    assetsInclude: ['**/*.hdr'],
  });
```

This is the only thing that wired the dev frontend to the local proxy server. With this in place plus `npm run dev` (which used to run `node server/gee-proxy.js & vite`), browser fetches to `/api/gee/*` reached the Node proxy transparently.

---

### 2.8 `package.json` — dep + scripts

```diff
  "scripts": {
-   "dev":         "node server/gee-proxy.js & vite",
-   "dev:frontend": "vite",
-   "dev:gee":     "node server/gee-proxy.js",
+   "dev":         "vite",
    "build":       "vite build",
    "preview":     "vite preview"
  },
  "dependencies": {
    "geotiff": "^3.0.4",
-   "google-auth-library": "^9.0.0",
    "three":   "^0.160.0",
    "three-gpu-pathtracer": "^0.0.20"
  },
```

---

## 3. What's still in the codebase but dormant

These pieces survived the strip and are inert in this fork. They become live again the moment a real `gee.js` is restored:

- `src/data/satellite.js` — registry only; `source: 'gee-satellite-scene'` no longer matches any handler (the case in `main.js` was deleted).
- `src/data/gee.js` — replaced by a stub. All function names match the originals so existing imports resolve.
- `src/ui/controls.js` — full satellite preview modal logic, date window, NDVI palette controls, RGB band/color pickers, scene-card rendering, "Find imagery" button, etc. About 700 lines of dormant code. None of it triggers because the entry-point button is removed in HTML.
- `index.html` — `<div id="satellite-modal">` and the satellite fields div both still exist (hidden).
- `main.js` — `mode === 'satellite'` branch in `handleGenerate` is dead code; safe to keep or delete.

To revive: restore `src/data/gee.js` + `server/gee-proxy.js`, un-hide the satellite mode button, re-add the `/api/gee` Vite proxy, re-add `google-auth-library`, place `service-account.json` one directory up, and the four GEE datasets in `datasets.js` if you want them in the dropdown.

---

## 4. Reconstruction order if you go back to GEE

1. Recover `service-account.json` (from password manager, GCP console, or wherever the original lives).
2. Rebuild `server/gee-proxy.js` against the endpoint contract in §1.1. `computePixels` reference: <https://developers.google.com/earth-engine/reference/rest/v1/projects.image/computePixels>.
3. Rebuild `src/data/gee.js` against the call sites in §1.2 — easier than the proxy because all callers are documented above.
4. Restore the four dataset entries in §2.1, the satellite registry in §2.2, and the elevation candidates + mode dispatch in §2.3.
5. Reverse the diffs in §2.4–2.8.

---

## Appendix A — `CLAUDE.md` (verbatim)

```markdown
# 3D Land Cover Map Application

## Project Overview

A browser-based 3D terrain visualization app that replicates the aesthetic of Milos Popovic's rayshader-based 3D land cover maps (https://github.com/milos-agathon/3d-land-cover-map) entirely in the browser using Three.js.

Users search for any location via OSM Nominatim, select a raster dataset, and generate a 3D shaded terrain map with the raster draped as a texture. The terrain appears as a solid block (with skirt walls and a bottom face) floating above a shadow-receiving floor, replicating rayshader's `plot_3d(solid=TRUE)` look.

## Motivation

The original R pipeline requires installing R, rayshader, and running CPU-intensive path tracing. This app makes the same visualization accessible in a browser with no installation, and adds interactivity (orbit controls, z-scale slider, dataset switching, location search).

## Architecture

```
3d-landcover/
  index.html              - Single-page app, white-themed UI
  vite.config.js           - Dev server config, proxies /api/gee to port 3001
  package.json             - Dependencies: three, three-gpu-pathtracer, google-auth-library
  .gitignore               - Excludes node_modules, service-account.json, .hdr files
  server/
    gee-proxy.js           - Node.js server authenticating with GEE via service account
  src/
    main.js                - App entry: scene setup, render loop, event wiring
    data/
      datasets.js          - Registry of all available datasets (ESRI, GEE, OSM, Imagery)
      elevation.js         - AWS Terrarium tiles: fetches + decodes RGB elevation
      esri.js              - ESRI ImageServer + tile layer fetching
      gee.js               - GEE proxy client with availability checking
      tiles.js             - Generic tile stitcher (OSM, ESRI World Imagery)
    scene/
      terrain.js           - PlaneGeometry + vertex displacement + skirt walls + bottom
      shadow.js            - ShadowMaterial floor plane
      camera.js            - PerspectiveCamera + OrbitControls
      lighting.js          - Directional + ambient + hemisphere lights
    renderers/
      rasterizer.js        - Method A: WebGLRenderer + PCFSoftShadow + SSAO
      pathtracer.js        - Method B: three-gpu-pathtracer (progressive convergence)
    ui/
      controls.js          - Location search (Nominatim), dataset/year pickers, camera presets
      legend.js            - Discrete (classified) and gradient (continuous) legends
      overlay.js           - Loading spinner, title, sample counter
    utils/
      colormap.js          - Class value to RGB mapping for raw ESRI exports
      geom.js              - Bbox utilities, aspect ratio calculations
      texture.js           - Canvas to Three.js texture conversion
```

## Data Sources

### Always Available (no API key, works on static hosting)
- **AWS Terrain Tiles** (Terrarium encoding) - elevation data, free, no auth
- **ESRI Land Cover tiles** - Azure Blob Storage hosted LULC tiles
- **ESRI ImageServer** - `exportImage` endpoint for raw class values (may need CORS proxy)
- **OpenStreetMap tiles** - standard raster tiles
- **ESRI World Imagery** - satellite imagery tiles

### Requires GEE Proxy Server
- **ESRI LULC via GEE** - same data via Google Earth Engine
- **Dynamic World** - Google's 10m near-real-time land cover
- **NLCD** - US-only 30m land cover from USGS
- **ETH Canopy Height** - 10m global canopy height

GEE datasets gracefully show "[GEE - unavailable]" in the dropdown when the proxy is not running.

## Key Technical Details

### Terrain Geometry
- PlaneGeometry with vertex displacement from elevation data
- Skirt walls on all 4 edges creating the "solid slab" look
- Bottom face closing the block
- Z-scale slider (0-10) with internal multiplier of 0.05

### Elevation Encoding (Terrarium)
- `height = (R * 256 + G + B / 256) - 32768` (meters)
- Source: `s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`

### Two Render Methods
- **Rasterizer**: WebGLRenderer + PCFSoftShadowMap + SSAO post-processing. Instant results.
- **Path Tracer**: three-gpu-pathtracer for physically-based rendering. Progressive convergence, shows sample counter. Resets on camera move.

### GEE Proxy Authentication
- Uses `google-auth-library` with a service account JSON
- Service account file at `../service-account.json` (NOT in the app directory, excluded from git)
- Calls Earth Engine REST API `computePixels` endpoint
- Project ID: `generalresearch-478019`
- Service account email: `jarvis@generalresearch-478019.iam.gserviceaccount.com`

### Location Search
- Uses OpenStreetMap Nominatim API (free, no key, rate-limited)
- Returns bounding boxes for cities, regions, countries
- 400ms debounce on input

## UI Features
- White background theme
- Camera preset buttons: Oblique, Top, Front, Side
- Title and Legend toggle buttons (show/hide)
- Legend is draggable
- Z-scale slider with real-time update
- Export PNG button
- Render mode toggle (Rasterizer / Path Tracer)

## Hosting Notes

### GitHub Pages (Static - No GEE)
1. Run `npx vite build` to create `dist/`
2. Deploy `dist/` to GitHub Pages
3. All non-GEE datasets work. GEE datasets show as "unavailable"
4. No server needed

### Full Deployment (With GEE)
To enable GEE datasets on a deployed site, the proxy server needs a backend host:

**Option A: Vercel Serverless Functions**
- Move `server/gee-proxy.js` logic into `api/gee/thumbnail.js`
- Add service account credentials as Vercel environment variables
- Frontend calls `/api/gee/thumbnail` which hits the serverless function

**Option B: Railway / Fly.io / Render**
- Deploy the Node.js proxy as a separate service
- Set `GOOGLE_APPLICATION_CREDENTIALS` env var to the service account JSON content
- Update `vite.config.js` proxy target or use env var for the API base URL

**Option C: Cloud Run**
- Containerize the proxy server
- Mount service account as a secret
- Cheapest for low traffic (scales to zero)

### Important for Any Deployment
- NEVER commit `service-account.json` to git
- Use environment variables or secret managers for credentials
- The Nominatim API has a usage policy: max 1 request/second, include a User-Agent

## Adding New Datasets

Add an entry to `src/data/datasets.js`:
```js
{
  id: 'my-dataset',
  name: 'My Dataset Name',
  source: 'gee',           // or 'esri', 'esri-tiles', 'osm-tiles', 'esri-world-imagery'
  type: 'classified',      // or 'continuous', 'none'
  assetId: 'GEE/ASSET/ID', // for GEE sources only
  years: [2020, 2021],     // null if not time-series
  visParams: { ... },      // for GEE sources only
  colormap: { ... },       // for classified datasets (legend + coloring)
  legend: { ... },         // for continuous datasets (gradient bar)
}
```

The rendering pipeline is source-agnostic. All sources produce a PNG bitmap that gets draped on the terrain.
```

---

## Appendix B — `Map_maker/GEE-PROXY.md`

This was a sibling file *outside* the `3d-landcover/` directory, so I never deleted or read it. If it still exists at `Map_maker/GEE-PROXY.md`, it likely contains the operational notes for the proxy (auth steps, deployment, env vars). Check there first before reconstructing anything.
