/**
 * Auth state singleton (Alpha 4.25). Tracks the current Supabase user
 * and notifies subscribers when it changes (sign-in, sign-out, token
 * refresh). UI components subscribe via `onAuthChange(handler)` and
 * unsubscribe via the returned function.
 *
 * Centralised here so we don't sprinkle `supabase.auth.onAuthStateChange`
 * calls across the codebase — one source of truth, easy to reason about.
 */

import type { Session, User } from '@supabase/supabase-js';
import { getSupabase } from './SupabaseClient';

export interface AuthSnapshot {
  user: User | null;
  session: Session | null;
}

let current: AuthSnapshot = { user: null, session: null };
const listeners = new Set<(snap: AuthSnapshot) => void>();
const passwordRecoveryListeners = new Set<() => void>();
let initialized = false;

/**
 * Initialise the auth state singleton. Pulls the existing session from
 * Supabase (if any) and subscribes to future changes. Idempotent —
 * call once at app boot. Safe to call when Supabase isn't configured;
 * just leaves `current` at the empty default.
 */
export async function initAuth(): Promise<AuthSnapshot> {
  if (initialized) return current;
  initialized = true;
  const supa = getSupabase();
  if (!supa) return current;
  // Restore session from localStorage (if any). Supabase reads it from
  // the configured storage and refreshes the token if needed.
  const { data } = await supa.auth.getSession();
  current = { session: data.session, user: data.session?.user ?? null };
  // Subscribe to future changes — sign-in, sign-out, token refresh,
  // password-recovery (Beta 1.0.8). PASSWORD_RECOVERY fires when the
  // user clicks the recovery link in their email and lands back on
  // mqcity.app with a recovery token in the URL — Supabase auto-
  // detects it (detectSessionInUrl:true) and signs them in with a
  // temporary recovery session before firing this event. The auth
  // modal listens for it and pops the "set new password" pane.
  supa.auth.onAuthStateChange((event, session) => {
    current = { session, user: session?.user ?? null };
    for (const fn of listeners) fn(current);
    if (event === 'PASSWORD_RECOVERY') {
      for (const fn of passwordRecoveryListeners) fn();
    }
  });
  return current;
}

export function getAuth(): AuthSnapshot {
  return current;
}

export function isSignedIn(): boolean {
  return current.user !== null;
}

/**
 * Subscribe to auth state changes. Returns an unsubscribe function.
 * Fires immediately on subscribe with the current state so the
 * subscriber doesn't have to handle a "never seen a value" case.
 */
export function onAuthChange(handler: (snap: AuthSnapshot) => void): () => void {
  listeners.add(handler);
  // Fire once with the current state so the subscriber doesn't have to
  // separately call getAuth() to bootstrap their UI.
  handler(current);
  return () => { listeners.delete(handler); };
}

/**
 * Subscribe to PASSWORD_RECOVERY events specifically (Beta 1.0.8).
 * Fires when the user clicks the recovery link in their email and the
 * SDK detects the recovery token in the URL. The auth-modal listener
 * uses this to pop the "set new password" pane.
 */
export function onPasswordRecovery(handler: () => void): () => void {
  passwordRecoveryListeners.add(handler);
  return () => { passwordRecoveryListeners.delete(handler); };
}
