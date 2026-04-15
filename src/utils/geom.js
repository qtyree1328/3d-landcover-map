// Bounding box and coordinate utilities

export function bboxAspectRatio(bbox) {
  const [xmin, ymin, xmax, ymax] = bbox;
  const lngSpan = xmax - xmin;
  const latSpan = ymax - ymin;
  // Approximate aspect ratio accounting for latitude
  const midLat = (ymin + ymax) / 2;
  const lngCorrected = lngSpan * Math.cos((midLat * Math.PI) / 180);
  return lngCorrected / latSpan;
}

export function expandBbox(bbox, factor = 0.05) {
  const [xmin, ymin, xmax, ymax] = bbox;
  const lngPad = (xmax - xmin) * factor;
  const latPad = (ymax - ymin) * factor;
  return [xmin - lngPad, ymin - latPad, xmax + lngPad, ymax + latPad];
}

export function bboxCenter(bbox) {
  return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
}
