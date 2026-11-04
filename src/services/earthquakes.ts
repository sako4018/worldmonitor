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

// Fork: static hosting has no seismology API, so read USGS's public GeoJSON feed (CORS-enabled) directly.
async function fetchUsgsDirect(signal: AbortSignal): Promise<ListEarthquakesResponse> {
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
  return { earthquakes };
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
