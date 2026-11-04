#!/usr/bin/env node
/**
 * Fork-only helper: builds higher-resolution boundary overrides for EVERY country
 * from Natural Earth 50m Admin 0 Countries, so highlighted country shapes match
 * the basemap borders (the bundled countries.geojson is heavily simplified).
 *
 * Output: public/data/country-boundary-overrides-world.geojson
 * Use it by setting in .env.local:
 *   VITE_COUNTRY_OVERRIDES_URL=/data/country-boundary-overrides-world.geojson
 *
 * Only countries whose ISO2 code exists in public/data/countries.geojson are kept,
 * because country-geometry.ts only replaces existing features.
 *
 * Usage: node scripts/fetch-world-boundary-overrides.mjs
 * Requires network access (~24 MB download).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NE_50M_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson';
const DATA_DIR = join(__dirname, '..', 'public', 'data');
const MAIN_FILE = join(DATA_DIR, 'countries.geojson');
const OUT_FILE = join(DATA_DIR, 'country-boundary-overrides-world.geojson');

// 4 decimals ≈ 11 m — far below what the map can show, and keeps the file small.
const round = (value) => (Array.isArray(value) ? value.map(round) : Math.round(value * 1e4) / 1e4);

function iso2Of(props) {
  // Natural Earth uses -99 in ISO_A2 for a few countries (France, Norway, Kosovo); ISO_A2_EH fills those in.
  for (const key of ['ISO_A2', 'ISO_A2_EH']) {
    const code = String(props?.[key] ?? '').trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(code)) return code;
  }
  return null;
}

async function main() {
  const main = JSON.parse(readFileSync(MAIN_FILE, 'utf8'));
  const known = new Map();
  for (const f of main.features) {
    const code = String(f.properties?.['ISO3166-1-Alpha-2'] ?? '').trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(code)) known.set(code, f.properties);
  }

  console.log('Fetching Natural Earth 50m countries...');
  const resp = await fetch(NE_50M_URL, { signal: AbortSignal.timeout(120_000) });
  if (!resp.ok) throw new Error(`Fetch failed: ${resp.status} ${resp.statusText}`);
  const data = await resp.json();
  if (!data?.features?.length) throw new Error('Invalid GeoJSON: no features');

  const features = [];
  const seen = new Set();
  for (const f of data.features) {
    const code = iso2Of(f.properties);
    if (!code || seen.has(code) || !known.has(code) || !f.geometry) continue;
    seen.add(code);
    const props = known.get(code);
    features.push({
      type: 'Feature',
      properties: {
        name: props.name,
        'ISO3166-1-Alpha-2': code,
        'ISO3166-1-Alpha-3': props['ISO3166-1-Alpha-3'],
      },
      geometry: { type: f.geometry.type, coordinates: round(f.geometry.coordinates) },
    });
  }

  const missing = [...known.keys()].filter((c) => !seen.has(c));
  writeFileSync(OUT_FILE, JSON.stringify({ type: 'FeatureCollection', features }) + '\n', 'utf8');
  console.log('Wrote', OUT_FILE, `(${features.length} countries)`);
  if (missing.length) console.log('Kept simplified shape (not in Natural Earth 50m):', missing.join(' '));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
