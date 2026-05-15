# Cloud saves setup (Supabase) — beta launch checklist

The game ships with **optional** cloud-saves backed by Supabase
(Postgres + Auth). Without it, the game falls back to local-only
IndexedDB and the Account pill / sign-in modal never appear — every
existing single-player path keeps working unchanged.

If you want to enable cloud saves for the beta, this is the entire
setup. ~10 minutes.

## 1. Create a Supabase project

1. Go to https://supabase.com → sign in (free) → **New project**.
2. Pick a project name (e.g. `mobile-city-builder`), a strong DB
   password (you won't usually need it), and the closest region.
3. Wait ~2 minutes for the project to provision.

## 2. Run the schema

Open the project's **SQL Editor** (left sidebar) → **New query** →
paste this and click **Run**:

```sql
create table cloud_saves (
  user_id     uuid references auth.users(id) on delete cascade,
  slot_key    text not null,                    -- 'main' / 'slot2' / 'slot3'
  city_name   text,
  last_played timestamptz default now(),
  save_blob   bytea not null,                   -- gzipped JSON SaveData
  primary key (user_id, slot_key)
);

alter table cloud_saves enable row level security;

create policy "users see own saves"
  on cloud_saves
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

That's it for the schema. RLS guarantees users can only see / write
their own rows.

## 3. Configure auth providers

Go to **Authentication → Providers**.

### Email (always enabled)
- Leave **Email** enabled.
- Decide on email confirmation: ON = users must verify their email
  with a 6-digit code before signing in (better for spam-prevention);
  OFF = sign-up signs them in immediately (better for fast playtest).
  Toggle in **Authentication → Providers → Email → Confirm email**.

### Switch the verification emails to send a 6-digit CODE (not a link)
By default Supabase emails users a "click this link to verify" message.
The auth modal in this app expects a **6-digit one-time code instead**
— easier for users to trust ("just a code from MQ City Builder") vs. a
long random link from a domain they don't recognise.

Two email templates need updating:

1. **Authentication → Email Templates → Confirm signup** → click
   **Edit template**. Replace the body so it sends `{{ .Token }}`
   instead of `{{ .ConfirmationURL }}`. A clean version:

   ```html
   <h2>Confirm your MQ City Builder account</h2>
   <p>Your verification code is:</p>
   <p style="font-size:24px;letter-spacing:0.2em;font-family:monospace">{{ .Token }}</p>
   <p>Enter this code in the game to finish signing up. The code expires in 60 minutes.</p>
   ```

2. **Authentication → Email Templates → Magic Link** → same swap:

   ```html
   <h2>Sign in to MQ City Builder</h2>
   <p>Your sign-in code is:</p>
   <p style="font-size:24px;letter-spacing:0.2em;font-family:monospace">{{ .Token }}</p>
   <p>Enter this code in the game to sign in. The code expires in 60 minutes.</p>
   ```

Save each template. Done — new sign-ups and magic-link requests now
deliver a 6-digit code that the player types into the verify-code
pane in the auth modal.

### Google (optional, ~5 minutes)
The auth modal shows a "Continue with Google" button by default — to
make it actually work:

1. **Authentication → Providers → Google → Enable**.
2. Follow Supabase's in-page wizard:
   - Open Google Cloud Console → APIs & Services → Credentials → Create OAuth Client ID
   - Application type: **Web application**
   - Authorized redirect URI: copy from Supabase's Google config page (looks like `https://<your-project>.supabase.co/auth/v1/callback`)
   - Copy the **Client ID** and **Client secret** back into Supabase
3. Save. Test by clicking the Google button in the auth modal.

### Apple (optional, requires Apple Developer account)
The "Continue with Apple" button is wired up but only works after:

1. You have an active Apple Developer account ($99/year).
2. **Authentication → Providers → Apple → Enable**.
3. Follow Supabase's wizard (Services ID, Sign-in Key, etc.).

Without Apple Developer setup, the button will show an error toast
when clicked — that's fine, you can ship without it and add later.

## 4. Get your project's URL + anon key

**Project Settings → API**:

- **Project URL** → goes into `VITE_SUPABASE_URL`
- **anon / public key** → goes into `VITE_SUPABASE_ANON_KEY`

The anon key is safe to ship in client code (RLS does the actual
gating). The **service-role** key is sensitive — never paste it
anywhere client-side.

## 5. Set the env vars locally

Copy `.env.example` to `.env.local`:

```sh
cp .env.example .env.local
```

Edit `.env.local` and fill in the two values. Restart `npm run dev`.

You should now see the **👤 Sign in** pill in the More menu.

## 6. Set the env vars in GitHub Actions (for prod build)

Go to your repo's **Settings → Secrets and variables → Actions →
New repository secret**:

- `VITE_SUPABASE_URL` — paste your Project URL
- `VITE_SUPABASE_ANON_KEY` — paste your anon key

The deploy workflow (`.github/workflows/deploy.yml`) already passes
these through to the build step.

## 7. Test

1. Visit your site, click **More** → **👤 Sign in**.
2. Create an account on the **Create account** tab. If email
   confirmation is on, check your inbox for the verification link.
3. Sign in. The page reloads, your IndexedDB save (if any) gets
   superseded by the (empty) cloud save for slot `main`. Build
   something.
4. Open the same URL on a different browser / device, sign in with
   the same account. Your city loads from the cloud.

## Cost / scale notes

- **Free tier**: 50K monthly active users, 500 MB database,
  unlimited API requests. You'll be on this tier for a long time.
- **Pro plan** ($25/mo): bumps to 100K MAU + 8 GB. Use only when
  you outgrow free.
- Each save row is ~25-90 KB compressed. 500 MB ≈ 5K-20K full saves.
  At 3 slots per user, that's 1.6K-6.6K active users on the free
  tier.

## What this changes vs. local-only mode

| | Local-only (no Supabase) | Cloud-enabled |
|---|---|---|
| Save location | IndexedDB on this device | Supabase (cloud) + IndexedDB cache |
| Cross-device | Only via portable city codes | Automatic when signed in |
| Sign-up required | No | Optional — game still plays signed-out |
| Account pill in HUD | Hidden | Visible in More menu |
| Cost | $0 forever | $0 to ~50K MAU, then $25/mo |

The portable city-code feature stays in both modes — it's now
positioned as a **sharing** mechanism (send your city to a friend)
rather than a **backup** mechanism (when cloud handles backup
automatically).
