/**
 * "What's New" update popup (Beta 1.8). Shown to a RETURNING player when
 * the app's MINOR version has changed since they last loaded the game
 * (e.g. 1.7.x → 1.8.0) — i.e. a "0.X decimal change". A patch bump
 * (1.8.0 → 1.8.1) does NOT trigger it, and a brand-new player (no
 * last-seen version stored) doesn't see it either — they just get the
 * current version recorded silently.
 *
 * If a player skips several minors (1.6 → 1.8), every minor strictly
 * newer than their last-seen one (up to current) is shown stacked, so
 * they catch up on everything since their last visit.
 *
 * The changelog lives in WHATS_NEW, keyed by `MAJOR.MINOR`. Add a new
 * entry whenever you ship a new minor (and bump APP_VERSION).
 */

import { APP_VERSION } from '../version';

const LAST_SEEN_KEY = 'mqcity-last-seen-version';

interface ChangeEntry {
  /** Headline shown as the section title, e.g. "Roundabouts". */
  title: string;
  /** Bullet highlights — short, player-facing, emoji-friendly. */
  highlights: string[];
}

/** Player-facing changelog, keyed by `MAJOR.MINOR`. Newest entries can be
 *  added at the top or bottom — display order is computed by version, not
 *  object order. */
const WHATS_NEW: Record<string, ChangeEntry> = {
  '1.9': {
    title: 'A better-looking city',
    highlights: [
      '🌇 Real sun shadows — buildings, trees and bridges now cast shadows that shift as the day passes, so the city reads as genuinely 3D.',
      '✨ A soft glow on night lights — lit windows, street lamps and sun glints bloom gently after dark while the daytime palette stays true.',
      '⚡ Big-city performance pass — placing roads and watching a large city grow no longer hitches; building updates are spread smoothly across frames.',
      'Tip: everything is the same on older phones — add ?fx=0 to the URL to fall back to the classic look if you ever need to.'
    ]
  },
  '1.8': {
    title: 'Roundabouts',
    highlights: [
      '🔄 New Roundabout tool in the Roads group — drop a small (2×2) or large (3×3) roundabout in a single tap.',
      'Traffic flows one-way around the island and exits in every direction, just like a real roundabout.',
      '🛡 No more crashes at the junction — circulating traffic never crosses, so a roundabout keeps a busy intersection flowing without gridlock.',
      '⛲ A detailed landscaped island with a fountain centrepiece — the large one adds ornamental trees and flower beds.',
      'Drivers and the Safer Streets Coalition both love them.'
    ]
  },
  '1.7': {
    title: 'Performance & polish',
    highlights: [
      '⚡ Faster, leaner build — smaller download and a smoother frame rate on phones.',
      'Fixed a slow memory leak that crept in when editing roads over a long session.',
      'The night sky now updates more efficiently for steadier performance.',
      'Tip: add ?dev=1 to the URL for a live FPS / performance overlay.'
    ]
  }
};

/** "1.8.0" → "1.8". Returns null for an unparseable version. */
function minorOf(version: string): string | null {
  const parts = version.split('.');
  if (parts.length < 2) return null;
  const major = Number(parts[0]);
  const minor = Number(parts[1]);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return null;
  return `${major}.${minor}`;
}

/** Compare two `MAJOR.MINOR` strings numerically. >0 if a is newer. */
function compareMinor(a: string, b: string): number {
  const [am, an] = a.split('.').map(Number) as [number, number];
  const [bm, bn] = b.split('.').map(Number) as [number, number];
  if (am !== bm) return am - bm;
  return an - bn;
}

/**
 * Check the stored last-seen version against the current one and, if the
 * minor changed for a returning player, show the popup. Always records the
 * current version afterward. Safe to call once on startup; self-gates.
 */
export function maybeShowWhatsNew(): void {
  let lastSeen: string | null = null;
  try {
    lastSeen = localStorage.getItem(LAST_SEEN_KEY);
  } catch {
    return; // No storage → can't track; skip silently.
  }

  const currentMinor = minorOf(APP_VERSION);
  if (!currentMinor) return;

  // Record the current version no matter what (so we don't re-show later).
  const record = (): void => {
    try { localStorage.setItem(LAST_SEEN_KEY, APP_VERSION); } catch { /* ignore */ }
  };

  // Brand-new player (or storage was cleared): record silently, no popup.
  if (!lastSeen) {
    record();
    return;
  }

  const lastMinor = minorOf(lastSeen);
  // Same minor (patch bump or identical) → nothing new to announce.
  if (!lastMinor || compareMinor(currentMinor, lastMinor) <= 0) {
    record();
    return;
  }

  // Gather every changelog entry whose minor is newer than the last-seen
  // minor and not newer than the current one, newest first.
  const entries = Object.keys(WHATS_NEW)
    .filter((m) => compareMinor(m, lastMinor) > 0 && compareMinor(m, currentMinor) <= 0)
    .sort((a, b) => compareMinor(b, a))
    .map((m) => ({ minor: m, ...WHATS_NEW[m]! }));

  record();
  if (entries.length === 0) return; // Minor changed but no notes — skip.

  showModal(entries);
}

function showModal(entries: Array<{ minor: string } & ChangeEntry>): void {
  const overlay = document.createElement('div');
  overlay.className = 'whats-new';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', "What's new");

  const sheet = document.createElement('div');
  sheet.className = 'whats-new__sheet';

  const heading = entries.length === 1
    ? `What's new in Beta ${entries[0]!.minor}`
    : "What's new since you were away";
  const title = document.createElement('div');
  title.className = 'whats-new__title';
  title.textContent = heading;
  sheet.appendChild(title);

  const body = document.createElement('div');
  body.className = 'whats-new__body';
  for (const entry of entries) {
    if (entries.length > 1) {
      const sub = document.createElement('div');
      sub.className = 'whats-new__section';
      sub.textContent = `Beta ${entry.minor} — ${entry.title}`;
      body.appendChild(sub);
    }
    const ul = document.createElement('ul');
    ul.className = 'whats-new__list';
    for (const h of entry.highlights) {
      const li = document.createElement('li');
      li.textContent = h;
      ul.appendChild(li);
    }
    body.appendChild(ul);
  }
  sheet.appendChild(body);

  const actions = document.createElement('div');
  actions.className = 'whats-new__actions';
  const cta = document.createElement('button');
  cta.type = 'button';
  cta.className = 'whats-new__cta';
  cta.textContent = 'Got it';
  const close = (): void => { overlay.remove(); };
  cta.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  actions.appendChild(cta);
  sheet.appendChild(actions);

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
}
