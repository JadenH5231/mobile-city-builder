# Hosting MQ City Builder as a Discord Activity

This is the manual side of the Discord integration. The code side (SDK,
iframe detection, identity hook, build wiring) shipped in **Beta 1.6.2**
and is fully opt-in via the `VITE_DISCORD_CLIENT_ID` env var. When that
var is unset (the default), the live mqcity.app build is byte-equivalent
to pre-1.6.2 — no Discord code runs.

Setting this var "turns on" the Discord path. You configure the var
itself (and a few Discord-side knobs) by following the steps below.
Total time: **~30 minutes** the first time, ~10 minutes for any future
re-deploys.

---

## What you'll end up with

- A Discord Application named "MQ City Builder" with an Application ID
  you control
- The same `mqcity.app` web build, ALSO reachable via Discord's
  Activities Shelf (rocket button in any voice channel)
- Players who launch it from Discord see their Discord display name
  pre-filled as the city name on a fresh save
- Standalone web players at mqcity.app are unaffected

You do NOT need to:
- Maintain a separate codebase
- Pay Discord any money
- Run a server (the Activity proxies through `discordsays.com` →
  `mqcity.app` directly)

---

## Step 1 — Create the Discord Application (~5 min)

1. Go to https://discord.com/developers/applications
2. Click **New Application** (top-right)
3. Name: `MQ City Builder` — click **Create**
4. On the resulting page, copy the **Application ID** (under
   General Information). It looks like `1234567890123456789`. Save
   this somewhere — you'll need it in Step 4.

---

## Step 2 — Enable Activities (~3 min)

1. In your new application's sidebar, click **Activities** →
   **Getting Started**
2. Click **Enable Activities** (or **Set Up an Activity** —
   wording varies)
3. Fill in:
   - **Activity Type:** `Embedded`
   - **Description:** "City builder — design + run a mobile-first
     low-poly city"
   - **Target Tier:** `Default` (free)
4. Save

---

## Step 3 — Configure URL Mappings (~5 min)

This is the **most important step**. Discord's iframe sandbox can
only fetch from domains you explicitly allowlist; everything else is
blocked. URL Mappings rewrite requests so the iframe sees them as
coming from `discordsays.com`.

1. In your application's sidebar, click **Activities** → **URL
   Mappings**
2. Add a mapping:
   - **Prefix:** `/`
   - **Target:** `mqcity.app`
3. If you have Supabase cloud saves enabled (you do — see
   `docs/CLOUD_SETUP.md`), add a SECOND mapping so the auth /
   save-load requests work from inside Discord:
   - **Prefix:** `/supabase/`
   - **Target:** `<your-project>.supabase.co`
4. Save

After this, the path
`https://<your-app-id>.discordsays.com/` proxies to
`https://mqcity.app/`, and `https://<your-app-id>.discordsays.com/supabase/auth/v1/token`
proxies to `https://<your-project>.supabase.co/auth/v1/token`.

---

## Step 4 — Add the env var as a GitHub Actions secret (~3 min)

1. Go to https://github.com/JadenH5231/mobile-city-builder/settings/secrets/actions
2. Click **New repository secret**
3. **Name:** `VITE_DISCORD_CLIENT_ID`
4. **Value:** the Application ID you copied in Step 1
5. **Add secret**

The deploy workflow (`.github/workflows/deploy.yml`) already reads
this secret and passes it to Vite at build time. So the very next
push to `main` will produce a build that activates the Discord
integration when loaded inside a Discord iframe.

To trigger a re-deploy without a code change, go to
https://github.com/JadenH5231/mobile-city-builder/actions/workflows/deploy.yml
and click **Run workflow** → **Run workflow**.

---

## Step 5 — (One-time) Submit your Activity for Shelf listing (~5 min)

Discord used to gate the Activities Shelf hard. Mid-2024 they opened
it to most developers, but a small approval is still required so they
can validate that your activity behaves (no malware, no broken iframe,
follows their content rules).

1. In your application's sidebar, click **Activities** → **Submit
   for Review** (might be called **Production** or **Shelf**
   depending on Discord's current naming)
2. Fill in the required content:
   - **Cover art:** can reuse the existing `public/mansion-icon.svg`
     or `public/pitch.html` social-share image. Discord wants ~1280×720
     PNG for the shelf thumbnail.
   - **Short description** (≤140 chars): "Design + run a mobile-first
     low-poly city. Roads, zones, factions, supply chains, all in
     your Discord voice channel."
   - **Tags:** `casual`, `creative`, `single-player`
3. Submit. Approval is typically 1-5 business days for a polished
   web app.

**Until approval clears**, you can still test the Activity via a direct
launch link: `https://discord.com/activities/<your-app-id>`. Paste this
in any Discord chat, click it, and Discord launches your app in a voice
channel iframe immediately. No shelf listing required.

---

## Step 6 — Test it

1. Open Discord (desktop or mobile)
2. Join any voice channel (your own server, a friend's server, or
   a personal "test" server)
3. Paste your launch link: `https://discord.com/activities/<your-app-id>`
4. Click the link → click **Launch**
5. The game loads in Discord's iframe. Verify:
   - The play area renders correctly
   - Long-press / tap interactions work
   - Default city name shows as `<YourDiscordName>'s City`
     (confirms the SDK identity hook fired)
   - Save/load works (test by zoning a few tiles, refreshing the
     iframe, confirming they persist)

---

## What's left to investigate later

Things that work TODAY in the standalone web build but may need extra
wiring once we get Discord-specific feedback:

- **Service worker / PWA install** — does NOT run inside Discord's
  iframe (browser security restriction). The game still works, just
  without offline support inside Discord. Standalone mqcity.app keeps
  full PWA install.
- **Shared multi-player session** — Activities are great for "all
  players in a voice channel see the same city + can both build."
  We'd need a sync layer; Supabase Realtime (already a dep) is the
  natural pick. Not blocking the basic single-player Activity.
- **Voice-channel member list** — `getInstanceConnectedParticipants`
  returns the list. We could surface "you're playing with 3 friends"
  in the HUD. Cosmetic future enhancement.
- **In-Discord monetization** — Discord has a SKU/IAP system for
  Activities. Currently irrelevant (single-purchase premium model;
  no IAPs per CLAUDE.md anti-goals).

---

## Troubleshooting

**"Activity won't launch — stuck on loading"**
- Check the iframe's Network tab (Discord dev tools: Ctrl+Shift+I
  on the Activity launch page). If you see CORS errors, your URL
  Mappings are wrong — re-check Step 3.
- The Supabase mapping is the most common miss. Without it, auth
  fails silently and the game appears to hang on first paint.

**"Default city name is still 'MetroQuest', not my Discord name"**
- `VITE_DISCORD_CLIENT_ID` wasn't passed at build time. Verify the
  secret name matches exactly (case-sensitive). Trigger a manual
  re-deploy after fixing.
- Or — the SDK init failed silently. Open the iframe's console
  (Discord dev tools) and look for `[discord] init failed` warnings.

**"Save data doesn't persist between launches"**
- IndexedDB is partitioned per-origin. The Discord version saves
  to `discordsays.com`; the standalone version saves to `mqcity.app`.
  These are separate stores — not a bug, but worth telling players.
  Cross-origin save sync would require the Supabase cloud-save flow
  (already implemented; just needs the Supabase URL mapping from
  Step 3 to work inside the iframe).

**"Discord rejected the Activity submission"**
- Common reasons: missing privacy policy link (you have one at
  https://mqcity.app/privacy.html ✓), missing terms of service
  (https://mqcity.app/terms.html ✓), or the cover art doesn't meet
  the 1280×720 spec. Fix and re-submit.

---

## How to roll it back

If anything goes sideways and you want to fully un-Discord the build:

1. Go to the GitHub Actions secrets page (Step 4 link above)
2. Delete the `VITE_DISCORD_CLIENT_ID` secret
3. Trigger a re-deploy

The next build will produce a Discord-inert artifact. Standalone
mqcity.app keeps working. Players who try to launch the (now-stale)
Discord Activity will see the game load but the SDK init path will
silently fall through to standalone mode — no crash, just no
Discord-specific niceties.
