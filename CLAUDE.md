# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

The upstream `AGENTS.md` above is the main engineering guide (architecture boundaries, landmarks, test map). This file adds what is specific to this fork.

## This fork

- Personal fork `sako4018/worldmonitor` of `koala73/worldmonitor` (remote `upstream`). Default branch here is `main`.
- Goal: a Bulgarian-first World Monitor for local use. Talk to the owner in Bulgarian; code, file names and commit messages stay in English.
- The upstream `AGENTS.md` assumes the upstream PR/CI flow ("deliver a ready PR", "continue through CI without another permission step"). That does **not** apply here: never open PRs or issues against `koala73/worldmonitor`, and do not commit, push, merge or tag without the owner's explicit OK in the current conversation.
- Keep fork changes small and in few files so `git fetch upstream && git merge upstream/main` stays easy.
- License is AGPL-3.0: the fork stays public.

## Fork changes to keep in mind

- `src/config/fork.ts`: `HIDE_PREMIUM` hides every paid/locked surface (Pro banner, upgrade/sign-in buttons, locked panels and widgets). Gate checks use it in `ProBanner.ts`, `panel-layout.ts`, `event-handlers.ts`, `ResilienceWidget.ts`, `App.ts`.
- Bulgarian is the default language via a `wmDefault` detector in `src/services/i18n.ts` (no `navigator`).
- Country borders: `.env.local` sets `VITE_COUNTRY_OVERRIDES_URL=/data/country-boundary-overrides-world.geojson`, built by `scripts/fetch-world-boundary-overrides.mjs` (fork-only).
- New feeds need: an entry in `shared/news-catalog.json`, the host in `shared/rss-allowed-domains.json` **and** `api/_rss-allowed-domains.js`, a country in `HOST_ORIGINS` (`scripts/source-origin.mjs`) when the TLD does not give one (`.am`, `.com`), then `node scripts/source-attribution.mjs --write` and `npm run generate`.
- `npm run generate` / `npm run sync:locales` also rewrite marketing counts (index.html, docs, blog, product facts) and the other 27 locales. Revert those and keep only runtime files, `bg.json` and `en.json`, to keep upstream merges small.
- Adding names to `DEFAULT_ENABLED_SOURCES` in `src/config/feeds.ts` breaks `tests/feed-catalog-drift.test.mts` (free-cap rules); keep extra feeds opt-in.
- Look: `src/styles/fork-theme.css` (imported at the top of `main.css`) overrides theme tokens with `html:root` / `html[data-theme]` specificity, removes forced uppercase with one `!important` rule, and puts Helvetica Neue first (SF Pro turns Cyrillic into Bulgarian letter shapes under `lang="bg"`; the owner wants standard shapes). System font is the default in `src/services/font-settings.ts`.
- Border files must have RFC 7946 winding (exterior rings counter-clockwise, holes clockwise). Natural Earth is clockwise; the flat map does not care but the 3D globe then fills the whole sphere red. `scripts/fetch-world-boundary-overrides.mjs` rewinds every ring.
- Map defaults: `DEFAULT_MAP_MODE = 'globe'` (`src/config/variants/base.ts`) and the desktop start view `DEFAULT_DESKTOP_VIEW = 'eu'` (`src/config/fork.ts`). The globe loads lazily (~20 s in dev) and then rotates to the view.
- Satellite/terrain basemaps: provider `imagery` in `src/config/basemap.ts` + `buildImageryStyle()` in `src/config/basemap-styles.ts` (Esri World Imagery / World Topo + Esri reference labels). CARTO raster labels need an API key (watermarks the whole map) - do not use them.
- Extra region-dropdown entries (`fork:bg`, `fork:caucasus`) live in `FORK_VIEW_PRESETS` (`src/config/fork.ts`) and call `setCenter()` with a flat-map zoom or a separate `globeZoom`; they avoid adding new `MapView` union members (12+ upstream files). Only the desktop header `#regionSelect` has them (not the mobile sheet or the DeckGL in-map select).
- Live TV/webcams: edit `src/config/live-video-sources.ts` (`WEBCAM_SOURCES`, `LIVE_NEWS_SOURCES`), list the feed in `WEBCAM_FEEDS` (`LiveWebcamsPanel.ts`) or `FULL_LIVE_CHANNELS` (`src/services/live-channels.ts`), then `npm run sync:live-video-channels`. The repo checker (`npm run live-video:check`) needs Playwright's own Chromium (not installed here); to verify a candidate, `curl` the YouTube watch page and look for `"isLiveNow":true` and `"playableInEmbed":true`.
- Screenshots: the owner works on the Mac at the same time, so never take full-screen captures (they grab whatever the owner is doing). Use Playwright with system Chrome in the background: `chromium.launch({channel:'chrome', headless:true, args:['--use-angle=metal','--ignore-gpu-blocklist','--enable-gpu']})` gives WebGL2, so deck.gl and the globe render.
- The `.husky` hooks are not active here (`core.hooksPath` unset).

## Running locally (macOS, Node 24 from `.nvmrc`)

```bash
npm ci
npm run dev            # Vite; uses 3000, or the next free port (3000 is often taken by another local app)
open -a Safari "http://localhost:3001/"
```

- No `.env` is needed for the web app. Without Redis/seeders/API keys some panels are empty (ACLED, seeded earthquakes, digest publication) and some RSS feeds fail — expected locally, not a bug.
- Other variants: `npm run dev:tech|dev:finance|dev:happy|dev:commodity|dev:energy`.

## Common checks

```bash
npm run typecheck && npm run lint:boundaries      # browser changes
npm run lint                                      # biome + safe-html
node --test tests/<name>.test.mjs                 # one data/unit test file
npx vitest run --config vitest.dom.config.mts tests/dom/<file>   # one DOM test
npm run sync:locales:check                        # locale files have the same keys as en.json
npm run generate                                  # regenerate committed derived files
```

## Where the Bulgarian work happens

- **UI language**: `src/services/i18n.ts`. Detection order is `wmQuery` (`?lang=xx`) → `wmExplicit` (choice saved in Settings) → `wmDefault` (`bg`, fork); `fallbackLng` is `en`. Non-`en` bundles are lazy-loaded.
- **Translations**: `src/locales/bg.json` (complete key set vs `en.json`; a few strings are still English). Keep keys in sync with `npm run sync:locales`.
- **News feeds**: single source of truth is `shared/news-catalog.json` (entry: `name`, `url` as string or `{lang: url}`, `lang`, `placements[]`). `src/config/news-catalog.browser.generated.ts` is generated by `scripts/generate-browser-news-catalog.mjs` — never edit it, run `npm run generate`. Feeds whose `lang` matches the UI language are enabled automatically (`getLanguageMatchedSources` in `src/config/feeds.ts`). Validate feeds with `npm run test:feeds`.
- **AI summaries** follow the UI language: client passes `getCurrentLanguage()` through `src/services/summarization.ts`; server `summarize-article.ts` checks it against `SUMMARY_OUTPUT_LANGUAGES` in the summarization `_shared.ts`, which builds the "Output the summary in … language" prompt line.
