/**
 * GUI addresses are `/apps/<slug>-<id>`; the id resolves, the slug is only for
 * humans (a stale slug redirects). Derived client-side from the name.
 */
export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'untitled';
}

export function slugPath(kind: 'apps' | 'projects', entity: { id: number; name: string }): string {
  return `/${kind}/${slugify(entity.name)}-${entity.id}`;
}

/** `"subway-reader-12"` → `{ slug: "subway-reader", id: 12 }`; a bare `"12"` also resolves. */
export function parseSlugId(param: string): { slug: string; id: number } | null {
  const m = /^(?:(.*)-)?(\d+)$/.exec(param);
  if (!m) return null;
  return { slug: m[1] ?? '', id: Number(m[2]) };
}
