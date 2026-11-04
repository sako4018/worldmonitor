/**
 * Fork-only switches. Keep this file tiny so upstream merges stay easy.
 *
 * HIDE_PREMIUM: hide every paid/locked surface (Pro banner, upgrade and
 * sign-in buttons, locked panels, locked widgets, Pro previews).
 */
export const HIDE_PREMIUM = true;

/** Initial map view on desktop (owner wants the globe opened over Europe). */
export const DEFAULT_DESKTOP_VIEW = 'eu' as const;
