/**
 * Cloud save store (Alpha 4.25). Persists `SaveData` to a Supabase
 * Postgres table when the user is signed in. Provides a slice of the
 * same interface as `SaveGame` (load / save / writeRaw / loadSummary
 * / clear) so the existing call sites can fan out to either local
 * or cloud depending on auth state.
 *
 * Schema (run in the Supabase SQL editor — see docs/CLOUD_SETUP.md):
 *
 *   create table cloud_saves (
 *     user_id    uuid references auth.users(id) on delete cascade,
 *     slot_key   text not null,                    -- 'main' / 'slot2' / 'slot3'
 *     city_name  text,
 *     last_played timestamptz default now(),
 *     save_blob  bytea not null,                   -- gzipped JSON SaveData
 *     primary key (user_id, slot_key)
 *   );
 *   alter table cloud_saves enable row level security;
 *   create policy "users see own saves" on cloud_saves
 *     for all using (auth.uid() = user_id);
 *
 * Saves are stored gzipped (same compression as the portable code)
 * to keep the row size small. The portable code's gzip pipeline is
 * reused — see `PortableSave.ts`.
 */

import type { SaveData, SlotSummary } from '../persistence/SaveGame';
import { getSupabase } from './SupabaseClient';
import { isSignedIn, getAuth } from './AuthState';

const TABLE = 'cloud_saves';

/** Encode a SaveData to a gzipped Uint8Array (same pipeline as the
 *  portable code, just without the base64 + header). */
async function gzipSave(data: SaveData): Promise<Uint8Array> {
  const json = JSON.stringify(data);
  const utf8 = new TextEncoder().encode(json);
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  void writer.write(utf8 as unknown as BufferSource);
  void writer.close();
  return await readAll(cs.readable);
}

/** Inverse of gzipSave. */
async function gunzipSave(bytes: Uint8Array): Promise<SaveData> {
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  void writer.write(bytes as unknown as BufferSource);
  void writer.close();
  const out = await readAll(ds.readable);
  const json = new TextDecoder().decode(out);
  return JSON.parse(json) as SaveData;
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) { chunks.push(value); total += value.byteLength; }
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return out;
}

/** Postgres `bytea` comes back from PostgREST as a hex string prefixed
 *  with `\x` (e.g. `\x1f8b08…`). Convert it to bytes. */
function hexToBytes(hex: string): Uint8Array {
  if (hex.startsWith('\\x')) hex = hex.slice(2);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

/** Bytes → `\x…` hex string for sending bytea to PostgREST. */
function bytesToHex(bytes: Uint8Array): string {
  let s = '\\x';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

/**
 * Cloud-side save store. Mirrors the slice of `SaveGame` the rest of
 * the codebase actually uses. All methods short-circuit to a no-op
 * (or `undefined`) when the user isn't signed in — the caller falls
 * back to the local IndexedDB store in that case.
 */
export class CloudSaveStore {
  private slotKey: string = 'main';

  useSlot(slotKey: string): void { this.slotKey = slotKey; }
  currentSlot(): string { return this.slotKey; }

  /** Available iff Supabase is configured AND the user is signed in.
   *  Callers gate on this to decide cloud vs local. */
  available(): boolean {
    return getSupabase() !== null && isSignedIn();
  }

  /** Load the current slot's save from the cloud. Returns undefined
   *  when not signed in, when the slot has no save yet, or on any
   *  network/decode error (logged to console). */
  async load(): Promise<SaveData | undefined> {
    const supa = getSupabase();
    const auth = getAuth();
    if (!supa || !auth.user) return undefined;
    const { data, error } = await supa
      .from(TABLE)
      .select('save_blob')
      .eq('user_id', auth.user.id)
      .eq('slot_key', this.slotKey)
      .maybeSingle();
    if (error) {
      console.warn('[CloudSaveStore] load failed:', error.message);
      return undefined;
    }
    if (!data) return undefined;
    try {
      return await gunzipSave(hexToBytes(data.save_blob as string));
    } catch (e) {
      console.warn('[CloudSaveStore] decompress failed:', e);
      return undefined;
    }
  }

  /** Slot summaries for the slot picker — name + last-played + pop +
   *  treasury. Done as one query that returns all the user's slots. */
  async loadSummary(slotKey: string): Promise<SlotSummary | undefined> {
    const supa = getSupabase();
    const auth = getAuth();
    if (!supa || !auth.user) return undefined;
    const { data, error } = await supa
      .from(TABLE)
      .select('save_blob, city_name, last_played')
      .eq('user_id', auth.user.id)
      .eq('slot_key', slotKey)
      .maybeSingle();
    if (error || !data) return undefined;
    try {
      const save = await gunzipSave(hexToBytes(data.save_blob as string));
      return {
        cityName: (data.city_name as string | null) ?? save.cityName,
        monthsElapsed: save.monthsElapsed,
        treasury: save.treasury,
        highestPop: save.highestPop ?? 0,
        width: save.width,
        height: save.height,
        lastPlayedISO: (data.last_played as string | null) ?? save.lastPlayedISO
      };
    } catch {
      return undefined;
    }
  }

  /** Push a SaveData to the cloud for the current slot. No-op when
   *  not signed in. Errors are logged but not thrown — autosave is
   *  fire-and-forget by design. */
  async save(data: SaveData): Promise<void> {
    const supa = getSupabase();
    const auth = getAuth();
    if (!supa || !auth.user) return;
    try {
      const blob = await gzipSave(data);
      const { error } = await supa
        .from(TABLE)
        .upsert({
          user_id: auth.user.id,
          slot_key: this.slotKey,
          city_name: data.cityName ?? null,
          last_played: new Date().toISOString(),
          save_blob: bytesToHex(blob)
        });
      if (error) console.warn('[CloudSaveStore] save failed:', error.message);
    } catch (e) {
      console.warn('[CloudSaveStore] save threw:', e);
    }
  }

  /** Replace the current-slot save with a raw SaveData (used by the
   *  import-from-code flow so the imported city goes to cloud too,
   *  not just local). */
  async writeRaw(data: SaveData): Promise<void> {
    return this.save(data);
  }

  /** Delete the current slot's cloud save. */
  async clear(): Promise<void> {
    const supa = getSupabase();
    const auth = getAuth();
    if (!supa || !auth.user) return;
    const { error } = await supa
      .from(TABLE)
      .delete()
      .eq('user_id', auth.user.id)
      .eq('slot_key', this.slotKey);
    if (error) console.warn('[CloudSaveStore] clear failed:', error.message);
  }
}
