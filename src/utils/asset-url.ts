/**
 * Fork (sako4018): URL of a file in public/ that also works when the site is served from a
 * sub-path (GitHub Pages: /worldmonitor/). `import.meta.env` is missing under plain Node tests,
 * hence the guards.
 */
const BASE: string = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';

export function assetUrl(path: string): string {
  return `${BASE}${path.replace(/^\/+/, '')}`;
}
