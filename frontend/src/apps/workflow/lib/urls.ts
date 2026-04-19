/**
 * URL helpers for workflow routes.
 *
 * Detail pages use the pattern `/workflow/tree/{id}-{slug}` so links remain
 * bookmarkable and readable. The slug is best-effort — if it's missing we
 * fall back to the bare numeric id. The id prefix is always authoritative;
 * the tree backend parses the leading integer regardless of the slug tail.
 */

/** Build a `/workflow/tree/...` path from id + optional slug. */
export function treePath(id: number, slug?: string | null): string {
  if (slug) return `/workflow/tree/${id}-${slug}`
  return `/workflow/tree/${id}`
}

/** Extract the numeric id from a `{id}` or `{id}-{slug}` URL segment. */
export function parseIdFromRef(ref: string | undefined | null): number | null {
  if (!ref) return null
  const m = /^(\d+)/.exec(ref)
  if (!m || !m[1]) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}
