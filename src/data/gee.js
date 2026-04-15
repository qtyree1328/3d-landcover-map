// GEE support has been removed from this build.
// These stubs exist so any lingering imports don't blow up at module load.
// Callers that actually invoke them will see a clear error.

const GEE_DISABLED = 'Google Earth Engine support has been removed from this build.';

export async function checkGEEAvailability() {
  return false;
}

export function isGEEAvailable() {
  return false;
}

export async function fetchGEERaster() {
  throw new Error(GEE_DISABLED);
}

export async function fetchGEEElevation() {
  throw new Error(GEE_DISABLED);
}

export async function fetchGEESatelliteScenes() {
  throw new Error(GEE_DISABLED);
}
