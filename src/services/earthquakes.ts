import { getRpcBaseUrl } from '@/services/rpc-client';
import type { Earthquake as ProtoEarthquake, ListEarthquakesResponse } from '@/generated/client/worldmonitor/seismology/v1/service_client';
import { createCircuitBreaker } from '@/utils/circuit-breaker';
import { getHydratedData } from '@/services/bootstrap';
import { SeismologyServiceClient } from '@/services/generated-rpc-clients';
import { STATIC_SITE } from '@/config/fork';

// Proto Earthquake.source / .category (fields 12 / 13) carry USGS vs NRCan
// attribution. Keep the union so dashboard/MCP can narrow 'usgs' | 'nrcan'.
export type Earthquake = ProtoEarthquake & {
  source?: 'usgs' | 'nrcan' | string;
  category?: string;
};

const client = new SeismologyServiceClient(getRpcBaseUrl(), { fetch: (...args) => globalThis.fetch(...args) });
// Shorter than the 10-minute natural poll, so every poll asks the server. A
// longer TTL answered polls from the client cache and, once stale, showed the
// old list while refreshing in the background: a new quake appeared one poll
// late, up to two hours after USGS published it.
const breaker = createCircuitBreaker<ListEarthquakesResponse>({ name: 'Seismology', cacheTtlMs: 5 * 60 * 1000, persistCache: true });

const emptyFallback: ListEarthquakesResponse = { earthquakes: [] };
// The poll waits for a stale refresh, so a stalled request would hold back
// the whole natural-events load. At the deadline the saved list is returned.
const EARTHQUAKE_REQUEST_TIMEOUT_MS = 10_000;

// Small quakes around Bulgaria and the Balkans (EMSC, CORS-enabled). USGS covers magnitude 2.5+, so only
// smaller events are taken from here, which keeps the two lists disjoint.
const BALKANS_BOX = { minlat: 40.5, maxlat: 45, minlon: 21.5, maxlon: 29.5 };

async function fetchEmscBalkans(signal: AbortSignal): Promise<Earthquake[]> {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 19);
  const q = new URLSearchParams({
    format: 'json', minmag: '1', limit: '200', orderby: 'time', starttime: since,
    minlat: String(BALKANS_BOX.minlat), maxlat: String(BALKANS_BOX.maxlat),
    minlon: String(BALKANS_BOX.minlon), maxlon: String(BALKANS_BOX.maxlon),
  });
  const res = await globalThis.fetch(`https://www.seismicportal.eu/fdsnws/event/1/query?${q}`, { signal });
  if (!res.ok) throw new Error(`EMSC HTTP ${res.status}`);
  const data = await res.json() as { features?: Array<{ id: string; properties: { mag?: number; time?: string; lat?: number; lon?: number; depth?: number; flynn_region?: string; unid?: string } }> };
  return (data.features ?? [])
    .filter((f) => (f.properties.mag ?? 0) < 2.5)
    .map((f): Earthquake => ({
      id: `emsc-${f.properties.unid ?? f.id}`,
      place: f.properties.flynn_region ?? '',
      magnitude: f.properties.mag ?? 0,
      depthKm: Math.abs(f.properties.depth ?? 0),
      location: { latitude: f.properties.lat ?? 0, longitude: f.properties.lon ?? 0 },
      occurredAt: f.properties.time ? Date.parse(f.properties.time) : 0,
      sourceUrl: f.properties.unid ? `https://www.seismicportal.eu/eventdetails.html?unid=${f.properties.unid}` : '',
      source: 'emsc',
      category: '',
    }));
}

// Fork: static hosting has no seismology API, so read USGS's public GeoJSON feed (CORS-enabled) directly.
async function fetchUsgsDirect(signal: AbortSignal): Promise<ListEarthquakesResponse> {
  const emsc = fetchEmscBalkans(signal).catch(() => [] as Earthquake[]); // a missing EMSC answer must not hide USGS
  const res = await globalThis.fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson', { signal });
  if (!res.ok) throw new Error(`USGS HTTP ${res.status}`);
  const data = await res.json() as { features?: Array<{ id: string; properties: { place?: string; mag?: number; time?: number; url?: string }; geometry: { coordinates: number[] } }> };
  const earthquakes: Earthquake[] = (data.features ?? []).map((f) => ({
    id: f.id,
    place: f.properties.place ?? '',
    magnitude: f.properties.mag ?? 0,
    depthKm: f.geometry.coordinates[2] ?? 0,
    location: { latitude: f.geometry.coordinates[1] ?? 0, longitude: f.geometry.coordinates[0] ?? 0 },
    occurredAt: f.properties.time ?? 0,
    sourceUrl: f.properties.url ?? '',
    source: 'usgs',
    category: '',
  }));
  return { earthquakes: [...earthquakes, ...(await emsc)] };
}

export async function fetchEarthquakes(): Promise<Earthquake[]> {
  const hydrated = getHydratedData('earthquakes') as ListEarthquakesResponse | undefined;
  if (hydrated?.earthquakes?.length) {
    breaker.recordSuccess(hydrated);
    return hydrated.earthquakes as Earthquake[];
  }

  const response = await breaker.execute(async () => {
    if (STATIC_SITE) return fetchUsgsDirect(AbortSignal.timeout(EARTHQUAKE_REQUEST_TIMEOUT_MS));
    return client.listEarthquakes(
      { minMagnitude: 0, start: 0, end: 0, pageSize: 0, cursor: '' },
      { signal: AbortSignal.timeout(EARTHQUAKE_REQUEST_TIMEOUT_MS) },
    );
  }, emptyFallback, { shouldCache: (r) => r.earthquakes.length > 0, staleRefreshMode: 'await' });
  return response.earthquakes as Earthquake[];
}
