/**
 * Fork (sako4018): stable file name for a pre-fetched RSS feed. Shared by the browser
 * (rssProxyUrl) and scripts/fork-fetch-static-rss.mjs, so it must stay dependency-free.
 * Two FNV-1a style passes with different primes give 64 bits; not cryptographic, just collision-safe enough.
 */
export function staticRssKey(url: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9747b28c;
  for (let i = 0; i < url.length; i++) {
    const c = url.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}
