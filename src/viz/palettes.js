// Preset color palettes for raster visualization
// Each palette is an array of hex color stops for smooth interpolation

export const PALETTES = {
  viridis:  ['#440154','#482777','#3f4a8a','#31678e','#26838f','#1f9d8a','#6cce5a','#b6de2b','#fee825'],
  magma:    ['#000004','#180f3d','#440f76','#721f81','#9e2f7f','#cd4071','#f1605d','#fca636','#fcffa4'],
  inferno:  ['#000004','#1b0c41','#4a0c6b','#781c6d','#a52c60','#cf4446','#ed6925','#fb9b06','#fcffa4'],
  plasma:   ['#0d0887','#46039f','#7201a8','#9c179e','#bd3786','#d8576b','#ed7953','#fb9f3a','#f0f921'],
  cividis:  ['#002051','#0a326a','#2b446e','#4d566d','#6b6b6f','#8c8370','#ad9b58','#d2b53c','#fdea45'],
  turbo:    ['#30123b','#4662d7','#36aaf9','#1ae4b6','#72fe5e','#c8ef34','#faba39','#f66b19','#7a0403'],
  spectral: ['#9e0142','#d53e4f','#f46d43','#fdae61','#fee08b','#e6f598','#abdda4','#66c2a5','#3288bd'],
  rdylgn:   ['#a50026','#d73027','#f46d43','#fdae61','#fee08b','#d9ef8b','#a6d96a','#66bd63','#1a9850'],
  rdylbu:   ['#a50026','#d73027','#f46d43','#fdae61','#fee090','#abd9e9','#74add1','#4575b4','#313695'],
  blues:    ['#f7fbff','#deebf7','#c6dbef','#9ecae1','#6baed6','#4292c6','#2171b5','#08519c','#08306b'],
  greens:   ['#f7fcf5','#e5f5e0','#c7e9c0','#a1d99b','#74c476','#41ab5d','#238b45','#006d2c','#00441b'],
  reds:     ['#fff5f0','#fee0d2','#fcbba1','#fc9272','#fb6a4a','#ef3b2c','#cb181d','#a50f15','#67000d'],
  greys:    ['#ffffff','#f0f0f0','#d9d9d9','#bdbdbd','#969696','#737373','#525252','#252525','#000000'],
  terrain:  ['#333399','#0294fa','#00db75','#85e62c','#ffff00','#d6a428','#a05a2c','#808080','#ffffff'],
  ylorbr:   ['#ffffe5','#fff7bc','#fee391','#fec44f','#fe9929','#ec7014','#cc4c02','#993404','#662506'],
  pubugn:   ['#fff7fb','#ece2f0','#d0d1e6','#a6bddb','#67a9cf','#3690c0','#02818a','#016c59','#014636'],
};

export const PALETTE_NAMES = Object.keys(PALETTES);

/**
 * Sample a palette at position t ∈ [0, 1].
 * Returns [r, g, b] integers 0–255.
 */
export function samplePalette(paletteName, t) {
  const stops = PALETTES[paletteName] || PALETTES.viridis;
  t = Math.max(0, Math.min(1, t));
  const idx = t * (stops.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.min(lo + 1, stops.length - 1);
  const frac = idx - lo;
  return lerpColor(stops[lo], stops[hi], frac);
}

/**
 * CSS linear-gradient string for a palette preview.
 */
export function paletteGradientCSS(paletteName, direction = 'to right') {
  const stops = PALETTES[paletteName] || PALETTES.viridis;
  const cssStops = stops.map((c, i) => `${c} ${(i / (stops.length - 1)) * 100}%`);
  return `linear-gradient(${direction}, ${cssStops.join(', ')})`;
}

function lerpColor(hex1, hex2, t) {
  const [r1, g1, b1] = hexToRgbArr(hex1);
  const [r2, g2, b2] = hexToRgbArr(hex2);
  return [
    Math.round(r1 + (r2 - r1) * t),
    Math.round(g1 + (g2 - g1) * t),
    Math.round(b1 + (b2 - b1) * t),
  ];
}

function hexToRgbArr(hex) {
  hex = hex.replace('#', '');
  return [
    parseInt(hex.substring(0, 2), 16),
    parseInt(hex.substring(2, 4), 16),
    parseInt(hex.substring(4, 6), 16),
  ];
}
