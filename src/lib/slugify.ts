/**
 * URL-slugify a free-form title.
 *
 * - Lowercases, ASCII-folds, collapses non-alphanumerics to `-`.
 * - Trims leading/trailing dashes, dedupes internal dashes.
 * - Hard-caps at 60 chars (DB column is text, but keep URLs sane).
 */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/**
 * If `base` collides with an existing slug, append `-2`, `-3`, … until unique.
 * `exists` is async so callers can hit Supabase or any other store.
 */
export async function ensureUniqueSlug(
  base: string,
  exists: (candidate: string) => Promise<boolean>,
  maxAttempts = 50
): Promise<string> {
  const seed = slugify(base) || "task";
  if (!(await exists(seed))) return seed;
  for (let i = 2; i < maxAttempts + 2; i++) {
    const candidate = `${seed.slice(0, 60 - String(i).length - 1)}-${i}`;
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error(`could not allocate unique slug after ${maxAttempts} attempts`);
}
