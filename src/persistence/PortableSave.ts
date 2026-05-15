import { type SaveData } from './SaveGame';

/**
 * Portable save codec (Alpha 4.11). Encodes a SaveData snapshot into a
 * single base64 string the player can copy off one device and paste into
 * another to resume play there.
 *
 * Pipeline (encode):
 *   SaveData → JSON.stringify → UTF-8 bytes → gzip → base64 → with header
 *
 * Pipeline (decode):
 *   header check → base64 → gunzip → UTF-8 → JSON.parse → SaveData
 *
 * Why gzip via CompressionStream:
 *   - A small 64×64 map serializes to roughly 50–80 KB of JSON. Raw
 *     base64 of that is ~70–110 KB; gzipped + base64 is ~10–25 KB.
 *     Still long, but trivially copy-pasteable in any text channel.
 *   - CompressionStream/DecompressionStream is in every modern browser
 *     (Chrome 80+, Safari 16.4+, Firefox 113+) — no external library.
 *
 * The header `MQCITYv1.` lets us reject pasted text that obviously isn't
 * one of our codes BEFORE reaching the parser, and gives a place to
 * version the codec independently of the SaveData schema.
 *
 * Note: this is fundamentally a one-way snapshot. There's no merge
 * — importing always overwrites the destination slot. If the player
 * plays on Device A, exports, imports on B, plays more on B, they
 * have to export from B and re-import on A to bring those changes
 * back. Two-way sync needs a server, which this app doesn't have.
 */

const HEADER = 'MQCITYv1.';

export async function exportSaveCode(data: SaveData): Promise<string> {
  const json = JSON.stringify(data);
  const utf8 = new TextEncoder().encode(json);
  const gzipped = await gzipBytes(utf8);
  return HEADER + base64Encode(gzipped);
}

/**
 * Decode a portable save code. Throws Error with a player-friendly message
 * on any failure (bad header, base64 corruption, gunzip failure, JSON
 * parse failure, schema mismatch). The caller — typically the Settings
 * panel — surfaces the message in a status pill.
 */
export async function importSaveCode(code: string): Promise<SaveData> {
  const trimmed = code.trim().replace(/\s+/g, '');
  if (!trimmed.startsWith(HEADER)) {
    throw new Error("That doesn't look like a city code (missing header).");
  }
  const payload = trimmed.slice(HEADER.length);
  let gz: Uint8Array;
  try {
    gz = base64Decode(payload);
  } catch {
    throw new Error('City code is corrupted — base64 decoding failed.');
  }
  let json: string;
  try {
    const bytes = await gunzipBytes(gz);
    json = new TextDecoder().decode(bytes);
  } catch {
    throw new Error('City code is corrupted — could not decompress.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('City code is corrupted — JSON parse failed.');
  }
  if (!parsed || typeof parsed !== 'object' || typeof (parsed as { schemaVersion?: unknown }).schemaVersion !== 'number') {
    throw new Error("That code didn't decode to a valid city.");
  }
  // Defensive structural validation (Beta 1.0.7) — a portable code is
  // user-supplied input that the recipient might paste from any source
  // (Discord, forum, etc.). Reject obviously-malicious payloads BEFORE
  // they reach the renderer / sim where bad values would crash the tab.
  // We only check the spine of the SaveData; per-tile fields fall back to
  // safe defaults inside applySave.
  const p = parsed as Record<string, unknown>;
  const w = typeof p.width === 'number' ? p.width : 0;
  const h = typeof p.height === 'number' ? p.height : 0;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 8 || h < 8 || w > 512 || h > 512) {
    throw new Error(`That city's dimensions (${w}×${h}) are outside the supported range (8-512 tiles per side).`);
  }
  if (!Array.isArray(p.tiles)) {
    throw new Error('That city is missing its tile data.');
  }
  if (p.tiles.length !== w * h) {
    throw new Error(`That city's tile count (${p.tiles.length}) doesn't match its dimensions (${w}×${h} = ${w * h}).`);
  }
  if (p.roadEdges !== undefined && !Array.isArray(p.roadEdges)) {
    throw new Error('That city has malformed road data.');
  }
  return parsed as SaveData;
}

// --- internals ---------------------------------------------------------

async function gzipBytes(input: Uint8Array): Promise<Uint8Array> {
  // CompressionStream is the modern built-in. Wrap input in a tiny
  // ReadableStream → pipe through gzip → collect into a single buffer.
  // The `as BufferSource` cast quiets the TS lib mismatch between
  // Uint8Array<ArrayBufferLike> and the writer's BufferSource expectation.
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  void writer.write(input as unknown as BufferSource);
  void writer.close();
  return await readAllBytes(cs.readable);
}

async function gunzipBytes(input: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  void writer.write(input as unknown as BufferSource);
  void writer.close();
  return await readAllBytes(ds.readable);
}

async function readAllBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return out;
}

// btoa/atob round-trip via Latin-1 string. Chunked to avoid blowing the
// argument-count limit on String.fromCharCode for big payloads (~80KB+).
function base64Encode(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let s = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, bytes.length);
    s += String.fromCharCode(...bytes.subarray(i, end));
  }
  return btoa(s);
}

function base64Decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
