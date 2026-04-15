// Satellite imagery collection definitions for scene selection workflows.

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
      rgb: {
        bands: ['B4', 'B3', 'B2'],
        min: 0,
        max: 3000,
      },
      ndvi: {
        min: -0.2,
        max: 0.9,
        palette: ['8b0000', 'b8860b', 'f0e68c', '9acd32', '006400'],
      },
    },
    ndviBands: ['B8', 'B4'],
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
    availableBands: ['R', 'G', 'B', 'N'],
    visualizations: {
      rgb: {
        bands: ['R', 'G', 'B'],
        min: 0,
        max: 255,
      },
      ndvi: {
        min: -0.2,
        max: 0.9,
        palette: ['8b0000', 'b8860b', 'f0e68c', '9acd32', '006400'],
      },
    },
    ndviBands: ['N', 'R'],
    cloudProperty: null,
    supportsCloudFilter: false,
    defaultDateRangeDays: 365,
    dateRangeOptions: null,
  },
];

export function getSatelliteDataset(id) {
  return SATELLITE_DATASETS.find((dataset) => dataset.id === id);
}
