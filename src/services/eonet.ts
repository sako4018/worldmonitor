import type { NaturalEvent, NaturalEventCategory } from '@/types';
import { getRpcBaseUrl } from '@/services/rpc-client';
import { NATURAL_EVENT_CATEGORIES } from '@/types';
import type { ListNaturalEventsResponse } from '@/generated/client/worldmonitor/natural/v1/service_client';
import { createCircuitBreaker } from '@/utils/circuit-breaker';
import { getHydratedData } from '@/services/bootstrap';
import { NaturalServiceClient } from '@/services/generated-rpc-clients';
import { STATIC_SITE } from '@/config/fork';

const CATEGORY_ICONS: Record<NaturalEventCategory, string> = {
  severeStorms: '🌀',
  wildfires: '🔥',
  volcanoes: '🌋',
  earthquakes: '🔴',
  floods: '🌊',
  landslides: '⛰️',
  drought: '☀️',
  dustHaze: '🌫️',
  snow: '❄️',
  tempExtremes: '🌡️',
  seaLakeIce: '🧊',
  waterColor: '🦠',
  manmade: '⚠️',
};

export function getNaturalEventIcon(category: NaturalEventCategory): string {
  return CATEGORY_ICONS[category] || '⚠️';
}

function normalizeNaturalCategory(category: string | undefined): NaturalEventCategory {
  if (!category) return 'manmade';
  return NATURAL_EVENT_CATEGORIES.has(category as NaturalEventCategory)
    ? (category as NaturalEventCategory)
    : 'manmade';
}

const client = new NaturalServiceClient(getRpcBaseUrl(), { fetch: (...args) => globalThis.fetch(...args) });
const breaker = createCircuitBreaker<ListNaturalEventsResponse>({ name: 'NaturalEvents', cacheTtlMs: 30 * 60 * 1000, persistCache: true });

const emptyFallback: ListNaturalEventsResponse = { events: [], fetchedAt: 0, dataAvailable: false };

/** Exported for the embed loader, which receives this wire shape from the
 *  composed map-frame endpoint rather than from this module's own fetch. */
type NaturalMapEvent = Pick<ListNaturalEventsResponse['events'][number], 'id' | 'title' | 'category' | 'categoryTitle' | 'lat' | 'lon' | 'date' | 'closed'>
  & Partial<ListNaturalEventsResponse['events'][number]>;

export function toNaturalEvent(e: NaturalMapEvent): NaturalEvent {
  return {
    id: e.id,
    title: e.title,
    description: e.description || undefined,
    category: normalizeNaturalCategory(e.category),
    categoryTitle: e.categoryTitle,
    lat: e.lat,
    lon: e.lon,
    date: new Date(e.date),
    magnitude: e.magnitude ?? undefined,
    magnitudeUnit: e.magnitudeUnit ?? undefined,
    sourceUrl: e.sourceUrl || undefined,
    sourceName: e.sourceName || undefined,
    closed: e.closed,
    stormId: e.stormId || undefined,
    stormName: e.stormName || undefined,
    basin: e.basin || undefined,
    stormCategory: e.stormCategory ?? undefined,
    classification: e.classification || undefined,
    windKt: e.windKt ?? undefined,
    pressureMb: e.pressureMb ?? undefined,
    movementDir: e.movementDir ?? undefined,
    movementSpeedKt: e.movementSpeedKt ?? undefined,
    forecastTrack: e.forecastTrack?.length ? e.forecastTrack : undefined,
    conePolygon: e.conePolygon?.length
      ? e.conePolygon.map(ring => ring.points.map(p => [p.lon, p.lat]))
      : undefined,
    pastTrack: e.pastTrack?.length ? e.pastTrack : undefined,
    canonicalId: e.canonicalId || undefined,
    matchingConfidence: e.matchingConfidence || undefined,
    canonicalAliases: e.canonicalAliases?.length ? e.canonicalAliases : undefined,
    windAveragingPeriodMinutes: e.windAveragingPeriodMinutes ?? undefined,
    agencyObservations: e.agencyObservations?.length ? e.agencyObservations : undefined,
  };
}

// Fork: static hosting has no natural-events API, so read NASA EONET v3 directly (CORS-enabled).
// Its category ids already match NaturalEventCategory. Storm tracks and cones are not available this way.
type EonetGeometry = { date: string; type: string; coordinates: number[] | number[][][] | number[][]; magnitudeValue?: number | null; magnitudeUnit?: string | null };
type EonetEvent = { id: string; title: string; description?: string | null; link: string; closed?: string | null; categories: Array<{ id: string; title: string }>; sources?: Array<{ id: string; url: string }>; geometry: EonetGeometry[] };

function eonetPoint(g: EonetGeometry): [number, number] | null {
  const c = g.coordinates as unknown;
  if (g.type === 'Point' && Array.isArray(c) && typeof c[0] === 'number') return [c[0] as number, c[1] as number];
  if (g.type === 'Polygon' && Array.isArray(c)) {
    const ring = (c as number[][][])[0] ?? [];
    if (!ring.length) return null;
    const lon = ring.reduce((s, p) => s + (p[0] ?? 0), 0) / ring.length;
    const lat = ring.reduce((s, p) => s + (p[1] ?? 0), 0) / ring.length;
    return [lon, lat];
  }
  return null;
}

async function fetchEonetDirect(signal: AbortSignal): Promise<ListNaturalEventsResponse> {
  const res = await globalThis.fetch('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30&limit=500', { signal });
  if (!res.ok) throw new Error(`EONET HTTP ${res.status}`);
  const data = await res.json() as { events?: EonetEvent[] };
  const events: ListNaturalEventsResponse['events'] = [];
  for (const e of data.events ?? []) {
    const latest = [...e.geometry].reverse().find((g) => eonetPoint(g));
    const point = latest ? eonetPoint(latest) : null;
    if (!latest || !point) continue;
    const category = e.categories[0];
    events.push({
      id: e.id,
      title: e.title,
      description: e.description ?? '',
      category: category?.id ?? 'manmade',
      categoryTitle: category?.title ?? '',
      lat: point[1],
      lon: point[0],
      date: Date.parse(latest.date),
      magnitude: latest.magnitudeValue ?? 0,
      magnitudeUnit: latest.magnitudeUnit ?? '',
      sourceUrl: e.sources?.[0]?.url ?? e.link,
      sourceName: e.sources?.[0]?.id ?? 'NASA EONET',
      closed: !!e.closed,
      forecastTrack: [],
      conePolygon: [],
      pastTrack: [],
      canonicalAliases: [],
      agencyObservations: [],
    });
  }
  return { events, fetchedAt: Date.now(), dataAvailable: true };
}

export async function fetchNaturalEvents(_days = 30): Promise<NaturalEvent[]> {
  const hydrated = getHydratedData('naturalEvents') as ListNaturalEventsResponse | undefined;
  if (hydrated?.events?.length) {
    breaker.recordSuccess(hydrated);
    return hydrated.events.map(toNaturalEvent);
  }

  const response = await breaker.execute(async () => {
    if (STATIC_SITE) return fetchEonetDirect(AbortSignal.timeout(15_000));
    return client.listNaturalEvents({ days: 30 });
  }, emptyFallback, { shouldCache: (r) => r.events.length > 0 });

  return (response.events || []).map(toNaturalEvent);
}
