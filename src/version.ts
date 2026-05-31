/**
 * Canonical runtime app version (Beta 1.8). Single source of truth for the
 * "What's New" popup (src/ui/WhatsNew.ts) and any future version stamp.
 *
 * Format: `MAJOR.MINOR.PATCH` (the numeric part of the "Beta X.Y.Z" label
 * used in commits / docs). The "What's New" popup keys off the MINOR — it
 * fires for a returning player when the minor changes (1.7.x → 1.8.0) but
 * NOT for a patch bump (1.8.0 → 1.8.1).
 *
 * BUMP THIS on every release. When you ship a new MINOR (e.g. 1.9.0), also
 * add a matching entry to WHATS_NEW in src/ui/WhatsNew.ts so returning
 * players see what changed.
 */
export const APP_VERSION = '1.8.3';
