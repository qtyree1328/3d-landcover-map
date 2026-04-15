// Dataset registry — open-source, no-auth raster datasets.
// Every source in here works from a static host without a proxy or API key.
export const DATASETS = [
  {
    id: 'esri-lulc',
    name: 'ESRI Sentinel-2 Land Cover (10m)',
    source: 'esri',
    type: 'classified',
    nativeResolutionM: 10,
    maxResolution: 2048,
    years: [2017, 2018, 2019, 2020, 2021, 2022, 2023],
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
    id: 'esri-lulc-tiles',
    name: 'ESRI Land Cover (Tile Layer)',
    source: 'esri-tiles',
    type: 'classified',
    nativeResolutionM: 10,
    maxResolution: 2048,
    years: [2017, 2018, 2019, 2020, 2021, 2022, 2023],
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

  // Basemap / imagery layers — no year dimension, show up in source picker only.
  {
    id: 'osm-topo',
    name: 'OpenStreetMap',
    source: 'osm-tiles',
    type: 'none',
    maxResolution: 2048,
    years: null,
  },
  {
    id: 'esri-imagery',
    name: 'ESRI World Imagery (high-res)',
    source: 'esri-world-imagery',
    type: 'none',
    maxResolution: 4096,
    years: null,
  },
  {
    id: 'google-satellite',
    name: 'Google Satellite (high-res)',
    source: 'google-satellite',
    type: 'none',
    maxResolution: 4096,
    years: null,
  },
];

export function getDataset(id) {
  return DATASETS.find(d => d.id === id);
}

export function getDatasetsForUI() {
  return DATASETS.map(d => ({ id: d.id, name: d.name }));
}
