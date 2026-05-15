/**
 * Supabase client (Alpha 4.25 — beta cloud-saves prep).
 *
 * Single-instance client wrapped so the rest of the codebase can ask
 * `getSupabase()` and either receive the live client or `null`. Null
 * means cloud features are disabled (env vars not set). Every cloud
 * code path has to handle the null case so the game still works for
 * users who never sign in or for forks that haven't set up Supabase.
 *
 * Vite inlines `import.meta.env.VITE_SUPABASE_URL` and
 * `VITE_SUPABASE_ANON_KEY` at build time. The anon key is safe to ship
 * in client code — RLS policies on the database are what enforce
 * "users only see their own saves," not the key itself. (The
 * service-role key, which IS sensitive, never touches client code.)
 *
 * If you're forking this project: see `docs/CLOUD_SETUP.md` for the
 * 5-minute Supabase setup. Without it, the auth modal never shows
 * and saves stay in IndexedDB only — the game still plays fine.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;
let initialized = false;

export function getSupabase(): SupabaseClient | null {
  if (initialized) return client;
  initialized = true;
  // Vite replaces `import.meta.env.VITE_*` with literal strings at
  // build time. If they're empty/undefined we leave `client = null` and
  // the rest of the code paths gracefully no-op.
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !key) {
    // Don't warn — a fork without Supabase is a fully-supported state.
    return null;
  }
  client = createClient(url, key, {
    auth: {
      // Persist the session in localStorage so a refresh keeps the user
      // signed in. Default behaviour, but explicit so it's documented.
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true   // handles magic-link callback URLs
    }
  });
  return client;
}

/** True iff Supabase is configured. UI uses this to decide whether to
 *  show the Account pill / sign-in modal at all. */
export function isCloudEnabled(): boolean {
  return getSupabase() !== null;
}
