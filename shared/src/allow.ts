/**
 * `GF_ALLOW` (GF-186): the IPv4 networks besides loopback that the tracker
 * answers. Parsed here once, by the server at boot and by `goblin service
 * install --allow` before it writes a plist, so the two refuse the same text.
 */

/** One IPv4 network: its address as an unsigned 32-bit number, host bits cleared, and its prefix length. */
export interface Network {
  base: number;
  bits: number;
}

export type ParsedAllow = { ok: true; networks: Network[] } | { ok: false; entry: string };

const mask = (bits: number) => (bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0);

/** `a.b.c.d` as an unsigned number, or `undefined` when it is not four decimal octets. A leading zero is refused, since other tools read `010` as octal. */
function ipv4(text: string): number | undefined {
  const octets = text.split('.');
  if (octets.length !== 4 || !octets.every((octet) => /^(0|[1-9]\d{0,2})$/.test(octet) && Number(octet) <= 255)) return undefined;
  return octets.reduce((sum, octet) => sum * 256 + Number(octet), 0);
}

function network(entry: string): Network | undefined {
  const [address, prefix, ...rest] = entry.split('/');
  if (rest.length > 0 || prefix === undefined || !/^(0|[1-9]\d?)$/.test(prefix) || Number(prefix) > 32) return undefined;
  const base = ipv4(address as string);
  if (base === undefined) return undefined;
  const bits = Number(prefix);
  return { base: (base & mask(bits)) >>> 0, bits };
}

/**
 * Comma-separated CIDRs, whitespace around each allowed. Empty text is no
 * networks (loopback only); an empty segment, as in a trailing comma, is a
 * refusal naming it, because it is more likely a dropped network than nothing.
 */
export function parseAllow(text: string): ParsedAllow {
  if (text.trim() === '') return { ok: true, networks: [] };
  const networks: Network[] = [];
  for (const raw of text.split(',')) {
    const entry = raw.trim();
    const parsed = network(entry);
    if (parsed === undefined) return { ok: false, entry };
    networks.push(parsed);
  }
  return { ok: true, networks };
}

/** The sentence both refusals use, server and CLI. */
export const notANetwork = (entry: string) => `${entry === '' ? 'an empty entry' : `"${entry}"`} is not an IPv4 network like 192.168.64.0/24`;

/** The canonical text, which is what the plist stores and the boot line shows. */
export const formatAllow = (networks: Network[]): string =>
  networks.map(({ base, bits }) => `${[24, 16, 8, 0].map((shift) => (base >>> shift) & 255).join('.')}/${bits}`).join(',');

/** Loopback always, IPv4 or IPv6, and any IPv4 peer inside a listed network. `::ffff:a.b.c.d` is that IPv4 peer. */
export function admits(ip: string, allow: Network[]): boolean {
  const lowered = ip.toLowerCase();
  if (lowered === '::1') return true;
  const peer = ipv4(lowered.startsWith('::ffff:') ? lowered.slice('::ffff:'.length) : lowered);
  if (peer === undefined) return false;
  if (peer >>> 24 === 127) return true;
  return allow.some(({ base, bits }) => (peer & mask(bits)) >>> 0 === base);
}
