# 3D Land Cover Map

Browser-based 3D terrain + land cover visualization, inspired by Milos Popovic's [rayshader 3D land-cover maps](https://github.com/milos-agathon/3d-land-cover-map). Runs entirely on the client with [Three.js](https://threejs.org/) and uses only open, no-auth data sources.

**Live demo:** publishing to GitHub Pages from this repo.

## Data sources (no API keys, no backend)

- **Elevation:** AWS Terrarium tiles (global) + USGS 3DEP (US, 1–10 m)
- **Land cover:** ESRI 10 m Sentinel-2 Land Cover (2017–2023)
- **Imagery basemaps:** ESRI World Imagery, Google Satellite, OpenStreetMap
- **Geocoding:** OpenStreetMap Nominatim
- **Vector overlays:** Overpass / OSM.fr polygon boundaries

## Run locally

```bash
npm install
npm run dev
```

## Build for GitHub Pages

The Vite config reads `VITE_BASE` so assets resolve correctly under a project-page path:

```bash
VITE_BASE=/3d-landcover-map/ npm run build
```

The built site lives in `dist/` and is a pure static bundle — no server needed.

## Architecture

```
src/
  main.js              app entry, render loop, handlers
  data/
    datasets.js        dataset registry (ESRI + basemaps)
    elevation.js       Terrarium + USGS 3DEP fetchers
    esri.js            ESRI ImageServer + tile-layer fetchers
    tiles.js           generic tile stitcher (OSM, Google, ESRI World Imagery)
    satellite.js       (deprecated; kept for compat, returns empty)
    gee.js             (stub; GEE support removed)
    custom-raster.js   user-uploaded GeoTIFF / image support
  scene/               terrain mesh, lighting, shadow floor, camera
  renderers/           rasterizer + optional GPU path tracer
  ui/                  stepped controls, legend, overlays, vector panel
  viz/                 palettes + per-dataset viz state
  utils/               colormap, geometry, texture helpers
```

## High-resolution export

The export button renders the current viewport at 1×–4× its CSS size and downloads a PNG. The stitched tile canvases and the export canvas are both capped at **8192 px per side**, which is the safe ceiling across all mainstream desktop GPUs. Requesting a larger output produces a clear error rather than a silently-truncated image.

## Known limitations / ideas for later

- Custom DEM upload UI is present but disabled.
- No offline tile cache; tiles are re-fetched on every generate.
- The legacy "satellite imagery" mode (Sentinel-2 / NAIP) depended on a private GEE proxy and has been removed; adding it back would require a server-side endpoint.
- Path tracer exports are not yet wired to the scaled-render path.
- Leaflet and other libs are loaded via `<script>` from CDN in `index.html` rather than bundled — fine for Pages, but could be migrated to npm.

## Credit

Inspiration and color palettes originate from Milos Popovic's rayshader work. Elevation encoding uses the AWS Terrain Tiles open dataset.
