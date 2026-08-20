const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Short, sortable-enough, url-safe id: `tkt_lqz3f8k2a1`. */
export function newId(prefix: string, len = 10): string {
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return `${prefix}_${out}`;
}
