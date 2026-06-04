/**
 * Discord community CTA popup (Beta 1.9.3). A friendly, low-frequency
 * invite to join the Discord. Deliberately kept rare to avoid pop-up
 * fatigue — it appears:
 *
 *   1. On a genuine NEW sign-in (signed-out → signed-in), caught across the
 *      sign-in page reload via a persisted `was-signed-in` flag, and
 *   2. Once every Nth session (default 5) the player opens the page in a
 *      fresh load.
 *
 * Shows at most ONCE per page load (`shownThisSession`). Once the player
 * joins ("Join the Discord") or opts out ("Don't show this again") it never
 * shows again (`SUPPRESS_KEY`). A soft "Maybe later" just closes it and it
 * returns on the normal cadence. Showing it (by either trigger) resets the
 * session counter so the next cadence show is a full N sessions away.
 *
 * All state is per-device localStorage (like the tutorial-seen / what's-new
 * flags) — never part of the save file. Mirrors the self-contained
 * dynamic-DOM approach of WhatsNew.ts.
 */

const DISCORD_URL = 'https://discord.gg/WWfcRdnArU';

const SUPPRESS_KEY = 'mqcity-discord-cta-done';        // '1' = joined or opted out
const SESSION_COUNT_KEY = 'mqcity-discord-cta-sessions'; // integer string
const WAS_SIGNED_IN_KEY = 'mqcity-discord-was-signed-in'; // '1' if signed in last we checked
const SESSIONS_PER_SHOW = 5;

/** At most one Discord CTA per page load, shared by both triggers. */
let shownThisSession = false;

function readSuppressed(): boolean {
  // Fail closed: if storage is unavailable (private mode) we can't track
  // frequency, so don't risk nagging — treat as "already handled".
  try { return localStorage.getItem(SUPPRESS_KEY) === '1'; } catch { return true; }
}
function setSuppressed(): void {
  try { localStorage.setItem(SUPPRESS_KEY, '1'); } catch { /* private mode — best effort */ }
}

/** Don't stack the CTA on top of another first-load / blocking modal. */
function higherPriorityModalUp(): boolean {
  if (document.querySelector('.whats-new')) return true;
  const ids = ['auth-modal', 'tutorial-prompt', 'event-modal', 'council-panel'];
  return ids.some((id) => {
    const el = document.getElementById(id);
    return !!el && !el.classList.contains('hidden');
  });
}

/**
 * Call once per page load, early. Increments the session counter and, on
 * every Nth session, shows the CTA. No-op if suppressed, already shown this
 * session, or a higher-priority modal is up.
 */
export function tickDiscordSession(): void {
  if (shownThisSession || readSuppressed()) return;
  let count = 0;
  try {
    count = parseInt(localStorage.getItem(SESSION_COUNT_KEY) || '0', 10) || 0;
    count += 1;
    localStorage.setItem(SESSION_COUNT_KEY, String(count));
  } catch {
    return; // No storage → can't track cadence; skip silently.
  }
  if (count % SESSIONS_PER_SHOW === 0 && !higherPriorityModalUp()) {
    showDiscordCta();
  }
}

/**
 * Call once auth has settled (signed-in state is known). Shows the CTA the
 * first time the player transitions signed-out → signed-in. Reload-safe: a
 * sign-in reloads the page, so the "was I signed in before?" answer is read
 * from localStorage across the reload.
 */
export function checkDiscordSignin(isSignedIn: boolean): void {
  let wasSignedIn = false;
  try { wasSignedIn = localStorage.getItem(WAS_SIGNED_IN_KEY) === '1'; } catch { return; }

  if (!isSignedIn) {
    // Settled signed-out — clear the flag so the next sign-in counts as new.
    try { localStorage.removeItem(WAS_SIGNED_IN_KEY); } catch { /* ignore */ }
    return;
  }
  try { localStorage.setItem(WAS_SIGNED_IN_KEY, '1'); } catch { /* ignore */ }
  if (!wasSignedIn && !shownThisSession && !readSuppressed() && !higherPriorityModalUp()) {
    showDiscordCta();
  }
}

function showDiscordCta(): void {
  if (shownThisSession) return;
  shownThisSession = true;
  // Restart the session cadence so the next periodic show is a full
  // SESSIONS_PER_SHOW away — keeps the overall frequency low.
  try { localStorage.setItem(SESSION_COUNT_KEY, '0'); } catch { /* ignore */ }

  const overlay = document.createElement('div');
  overlay.className = 'discord-cta';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Join the Discord community');

  const sheet = document.createElement('div');
  sheet.className = 'discord-cta__sheet';

  // Discord logo mark.
  const icon = document.createElement('div');
  icon.className = 'discord-cta__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML =
    '<svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor">' +
    '<path d="M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.211.375-.444.864-.608 1.249a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.036A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.891.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>' +
    '</svg>';
  sheet.appendChild(icon);

  const title = document.createElement('div');
  title.className = 'discord-cta__title';
  title.textContent = 'Join the community';
  sheet.appendChild(title);

  const body = document.createElement('div');
  body.className = 'discord-cta__body';
  body.textContent =
    'Hang out with other mayors, show off your cities, swap tips, and hear ' +
    'about new features first. Come say hi on our Discord!';
  sheet.appendChild(body);

  const close = (): void => { overlay.remove(); };

  const actions = document.createElement('div');
  actions.className = 'discord-cta__actions';

  // Primary — opens the invite in a new tab and never asks again.
  const join = document.createElement('a');
  join.className = 'discord-cta__join';
  join.href = DISCORD_URL;
  join.target = '_blank';
  join.rel = 'noopener noreferrer';
  join.innerHTML =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">' +
    '<path d="M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.211.375-.444.864-.608 1.249a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.036A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.891.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>' +
    '</svg><span>Join the Discord</span>';
  join.addEventListener('click', () => { setSuppressed(); close(); });
  actions.appendChild(join);

  // Soft dismiss — returns on the normal cadence.
  const later = document.createElement('button');
  later.type = 'button';
  later.className = 'discord-cta__later';
  later.textContent = 'Maybe later';
  later.addEventListener('click', close);
  actions.appendChild(later);

  sheet.appendChild(actions);

  // Permanent opt-out for players who never want it.
  const never = document.createElement('button');
  never.type = 'button';
  never.className = 'discord-cta__never';
  never.textContent = "Don't show this again";
  never.addEventListener('click', () => { setSuppressed(); close(); });
  sheet.appendChild(never);

  // Backdrop click = soft dismiss (same as "Maybe later").
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
}
