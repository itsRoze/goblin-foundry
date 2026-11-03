/**
 * What a `PATCH` was judged on: the field it changes and what that field held,
 * as `judgement` writes it. The edit is refused with a 409 if that field alone
 * has since changed, so a write to another field, a label or a transition
 * landing meanwhile refuses nothing (ADR-0001, GF-79). Absent means the
 * request's own read.
 */
export const JUDGED_HEADER = 'X-Goblin-Judged';

/** `description=9f2a1c0e7b3d5a21`: the field and two FNV-1a hashes of what it held, cheaper on the wire than the body twice. `null` and `''` are the same empty field. */
export function judgement(field: string, held: string | null | undefined): string {
  const text = held ?? '';
  let a = 0x811c9dc5;
  let b = 0x050c5d1f;
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    a = Math.imul(a ^ unit, 0x01000193);
    b = Math.imul(b ^ unit, 0x01000193);
  }
  return `${field}=${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`;
}

/** The field a judgement names, or `null` when it is not one `judgement` wrote. */
export const judgedField = (header: string): string | null => /^([a-z_]+)=[0-9a-f]{16}$/.exec(header)?.[1] ?? null;
