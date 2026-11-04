/**
 * Fork-only switches. Keep this file tiny so upstream merges stay easy.
 *
 * HIDE_PREMIUM: hide every paid/locked surface (Pro banner, upgrade and
 * sign-in buttons, locked panels, locked widgets, Pro previews).
 */
export const HIDE_PREMIUM = true;

/** Initial map view on desktop (owner wants the globe opened over Europe). */
export const DEFAULT_DESKTOP_VIEW = 'eu' as const;

/**
 * Extra entries in the region dropdown. They reuse MapContainer.setCenter() instead of adding
 * new MapView types (which would touch ~12 upstream files). Keys are the <option> values.
 */
export const FORK_VIEW_PRESETS: Record<string, { lat: number; lon: number; zoom: number; globeZoom: number }> = {
  // zoom: flat map; globeZoom: 3D globe (its zoom scale is much closer to the ground)
  'fork:bg': { lat: 42.7, lon: 25.4, zoom: 6.3, globeZoom: 4.4 },
  'fork:caucasus': { lat: 40.8, lon: 44.8, zoom: 5.8, globeZoom: 3.9 },
};
