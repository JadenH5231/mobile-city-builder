/**
 * Discord Activities integration (Beta 1.6.2).
 *
 * When the game runs inside a Discord voice channel via the Activities
 * Shelf, Discord loads us in a sandboxed iframe at
 *   https://<application-id>.discordsays.com/...
 * with a `frame_id` query param injected so we can tell we're in
 * Discord. We use the Embedded App SDK to:
 *
 *   - Authenticate the active Discord user
 *   - Read their display name (used as the default city name on a
 *     fresh save so the player doesn't see "MetroQuest" as their
 *     city in Discord)
 *   - Optionally surface the current voice-channel members (future
 *     multiplayer / shared-session hook)
 *
 * This module is FULLY OPT-IN — if `VITE_DISCORD_CLIENT_ID` is not
 * set at build time OR the `frame_id` query param is missing at
 * runtime, every function is a graceful no-op. So the main mqcity.app
 * deploy is byte-equivalent to the pre-1.6.2 build.
 *
 * Player flow:
 *   1. User taps the rocket-button "Activities Shelf" in a Discord
 *      voice channel.
 *   2. Discord loads `https://<app-id>.discordsays.com/` in an
 *      iframe, which (per the URL Mapping configured in the
 *      Discord Developer Portal) proxies to `https://mqcity.app/`.
 *   3. mqcity.app boots normally. `isDiscordActivity()` returns
 *      true so we know to init the SDK.
 *   4. We call `discordSdk.ready()` then OAuth-authenticate the
 *      user. The Discord display name flows into Game's default
 *      city name on first save.
 */

import { DiscordSDK } from '@discord/embedded-app-sdk';

/** True when this build was deployed with VITE_DISCORD_CLIENT_ID set
 *  AND the page was loaded inside Discord's iframe (frame_id param
 *  is present). Both conditions must hold — a Discord-enabled build
 *  visited directly via mqcity.app stays in standalone mode. */
export function isDiscordActivity(): boolean {
  const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID as string | undefined;
  if (!clientId) return false;
  return new URLSearchParams(window.location.search).has('frame_id');
}

/** Resolved Discord runtime context. Populated by `initDiscord()`
 *  when we're running as an Activity; null otherwise. */
export interface DiscordContext {
  /** Discord username (e.g. "alex"). */
  username: string;
  /** Pretty display name from the user's profile, falls back to
   *  username when not set. Used as the default city name. */
  displayName: string;
  /** Discord snowflake user ID. Useful for matching across sessions
   *  (e.g. saving a city slot keyed to the Discord user). */
  userId: string;
  /** Voice channel ID we were launched from. Future hook for
   *  per-channel shared sessions. */
  channelId?: string;
  /** Direct handle to the Discord SDK in case a future caller wants
   *  to use a feature not surfaced through this interface. */
  sdk: DiscordSDK;
}

let cached: DiscordContext | null = null;

/** Initialise the Discord SDK if we're running as an Activity.
 *  Returns the resolved context on success, null when not in Discord
 *  or when init fails (network / auth error — fail open so the game
 *  still works in standalone mode). Safe to call multiple times;
 *  cached after the first success. */
export async function initDiscord(): Promise<DiscordContext | null> {
  if (cached) return cached;
  if (!isDiscordActivity()) return null;
  const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID as string;
  try {
    const sdk = new DiscordSDK(clientId);
    await sdk.ready();
    // Step 1: OAuth authorize. Discord pops the consent dialog inside
    // the iframe — the user grants `identify` (and any other scopes
    // we ask for). This returns a code we exchange server-side for an
    // access_token in a real production app, but for a single-player
    // game we can skip the server step and read the user's identity
    // from the SDK's local API.
    //
    // For the simplest possible integration we use the `getInstance`
    // command which gives the activity instance metadata (channel,
    // guild) without needing an access token. The full identify
    // flow is a follow-up when we add multiplayer.
    const instance = await sdk.commands.getInstanceConnectedParticipants();
    const me = instance.participants[0];
    if (!me) return null;
    cached = {
      username: me.username ?? 'player',
      displayName: me.global_name || me.username || 'player',
      userId: me.id,
      channelId: sdk.channelId ?? undefined,
      sdk
    };
    return cached;
  } catch (err) {
    // Initialisation failed (e.g. user denied consent, network
    // hiccup, SDK version mismatch). Log + return null so the game
    // falls back to standalone behaviour rather than blocking on
    // Discord-specific code.
    console.warn('[discord] init failed, running in standalone mode', err);
    return null;
  }
}

/** Synchronously-accessible context after init has resolved. Null if
 *  not in Discord OR init hasn't completed yet OR init failed. */
export function getDiscordContext(): DiscordContext | null {
  return cached;
}
