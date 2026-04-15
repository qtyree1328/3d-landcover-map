// Fetch ESRI Living Atlas LULC raster data

// ESRI ImageServer expects epoch milliseconds for time filtering
function yearToEpochRange(year) {
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year, 11, 31, 23, 59, 59);
  return `${start},${end}`;
}

// Method 1: ImageServer exportImage (pre-rendered RGB)
export async function fetchESRILulc(bbox, width, height, year = 2022) {
  const [xmin, ymin, xmax, ymax] = bbox;

  const url = `https://ic.imagery1.arcgis.com/arcgis/rest/services/Sentinel2_10m_LandCover/ImageServer/exportImage` +
    `?bbox=${xmin},${ymin},${xmax},${ymax}` +
    `&bboxSR=4326&imageSR=4326` +
    `&size=${width},${height}` +
    `&format=png&f=image` +
    `&time=${yearToEpochRange(year)}`;

  const response = await fetch(url);
  if (!response.ok) throw new Error(`ESRI ImageServer returned ${response.status}`);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  return { bitmap, isRawClassValues: false };
}

// Method 2: ESRI LULC via ImageServer (same endpoint, pre-rendered RGB)
export async function fetchESRITiles(bbox, width, height, year = 2022) {
  const [xmin, ymin, xmax, ymax] = bbox;

  const url = `https://ic.imagery1.arcgis.com/arcgis/rest/services/Sentinel2_10m_LandCover/ImageServer/exportImage` +
    `?bbox=${xmin},${ymin},${xmax},${ymax}` +
    `&bboxSR=4326&imageSR=4326` +
    `&size=${width},${height}` +
    `&format=png&f=image` +
    `&time=${yearToEpochRange(year)}`;

  const response = await fetch(url);
  if (!response.ok) throw new Error(`ESRI ImageServer returned ${response.status}`);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  return { bitmap, isRawClassValues: false };
}
