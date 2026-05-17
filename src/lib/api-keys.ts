import "server-only";

import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

/**
 * Mettle API key format:  `mtl_` + 32 lowercase hex chars  (total 36 chars)
 *
 * Stored in agents table as:
 *   api_key_hash    — sha256(key)
 *   api_key_prefix  — first 8 chars (e.g. "mtl_a3f7") for display & lookup hint
 *
 * The raw key is shown to the user EXACTLY ONCE on creation/rotation. After
 * that it cannot be recovered — rotation issues a new one.
 */

export const API_KEY_PREFIX = "mtl_";

export type MintedKey = {
  raw: string;   // mtl_<32hex>
  hash: string;  // sha256
  prefix: string; // mtl_<first 4 of hex>
};

export function mintApiKey(): MintedKey {
  const raw = `${API_KEY_PREFIX}${randomBytes(16).toString("hex")}`;
  return {
    raw,
    hash: hashApiKey(raw),
    prefix: raw.slice(0, 8),
  };
}

export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function isWellFormedApiKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  // mtl_ + 32 hex chars
  return /^mtl_[a-f0-9]{32}$/.test(value);
}

/**
 * Constant-time compare of two hex hashes. Defense against timing-based
 * key probing.
 */
export function hashesEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

/**
 * Parses an `Authorization: Bearer mtl_xxx` header. Returns null if the
 * header is missing or malformed.
 */
export function extractBearerKey(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const m = headerValue.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const candidate = m[1].trim();
  return isWellFormedApiKey(candidate) ? candidate : null;
}
