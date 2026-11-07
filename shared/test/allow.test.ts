import { describe, expect, test } from 'bun:test';
import { admits, formatAllow, parseAllow, type Network } from '../src/allow';

const networks = (text: string): Network[] => {
  const parsed = parseAllow(text);
  if (!parsed.ok) throw new Error(`refused ${parsed.entry}`);
  return parsed.networks;
};

describe('parseAllow', () => {
  test('reads comma-separated CIDRs, whitespace around each allowed', () => {
    expect(parseAllow(' 192.168.64.0/24 , 100.64.0.0/10')).toEqual({
      ok: true,
      networks: [
        { base: 0xc0a84000, bits: 24 },
        { base: 0x64400000, bits: 10 },
      ],
    });
  });

  test('empty text is no networks, which means loopback only', () => {
    expect(parseAllow('')).toEqual({ ok: true, networks: [] });
    expect(parseAllow('   ')).toEqual({ ok: true, networks: [] });
  });

  test('refuses naming the first entry that is not a network', () => {
    expect(parseAllow('192.168.64.0/33')).toEqual({ ok: false, entry: '192.168.64.0/33' });
    expect(parseAllow('300.1.1.1/24')).toEqual({ ok: false, entry: '300.1.1.1/24' });
    expect(parseAllow('10.0.0.0/8,foo')).toEqual({ ok: false, entry: 'foo' });
    expect(parseAllow('192.168.64.1')).toEqual({ ok: false, entry: '192.168.64.1' });
    expect(parseAllow('1.2.3/24')).toEqual({ ok: false, entry: '1.2.3/24' });
    expect(parseAllow('10.0.0.0/8/8')).toEqual({ ok: false, entry: '10.0.0.0/8/8' });
  });

  test('a leading zero is refused, because other tools read 010 as octal', () => {
    expect(parseAllow('010.0.0.0/8')).toEqual({ ok: false, entry: '010.0.0.0/8' });
    expect(parseAllow('10.0.0.0/08')).toEqual({ ok: false, entry: '10.0.0.0/08' });
    expect(parseAllow('10.0.0.0/0')).toEqual({ ok: true, networks: [{ base: 0, bits: 0 }] });
  });

  test('an empty segment is refused rather than read as nothing', () => {
    expect(parseAllow('192.168.64.0/24,')).toEqual({ ok: false, entry: '' });
    expect(parseAllow('192.168.64.0/24, ,10.0.0.0/8')).toEqual({ ok: false, entry: '' });
  });

  test('host bits are cleared, so the canonical text names the network', () => {
    expect(formatAllow(networks('192.168.64.7/24, 100.64.0.0/10'))).toBe('192.168.64.0/24,100.64.0.0/10');
    expect(formatAllow(networks('10.1.2.3/32,8.8.8.8/0'))).toBe('10.1.2.3/32,0.0.0.0/0');
  });
});

describe('admits', () => {
  test('loopback is always answered, in every form, with nothing allowed', () => {
    for (const ip of ['127.0.0.1', '127.255.0.9', '::1', '::ffff:127.0.0.1', '::FFFF:127.0.0.1']) expect([ip, admits(ip, [])]).toEqual([ip, true]);
  });

  test('with nothing allowed, every other peer is refused', () => {
    for (const ip of ['192.168.64.5', '::ffff:192.168.64.5', '10.0.0.1', 'fe80::1', '']) expect([ip, admits(ip, [])]).toEqual([ip, false]);
  });

  test('a peer inside a listed network is admitted and one outside it is not', () => {
    const vm = networks('192.168.64.0/24');
    expect(admits('192.168.64.5', vm)).toBe(true);
    expect(admits('192.168.64.255', vm)).toBe(true);
    expect(admits('192.168.65.5', vm)).toBe(false);
    expect(admits('192.168.63.255', vm)).toBe(false);
  });

  test('an IPv4-mapped IPv6 peer is its IPv4 address', () => {
    const vm = networks('192.168.64.0/24');
    expect(admits('::ffff:192.168.64.5', vm)).toBe(true);
    expect(admits('::ffff:192.168.65.5', vm)).toBe(false);
  });

  test('/0 admits every IPv4 peer and /32 exactly one', () => {
    expect(admits('203.0.113.9', networks('0.0.0.0/0'))).toBe(true);
    expect(admits('fe80::1', networks('0.0.0.0/0'))).toBe(false);
    const one = networks('192.168.64.5/32');
    expect(admits('192.168.64.5', one)).toBe(true);
    expect(admits('192.168.64.4', one)).toBe(false);
  });

  test('any of several networks admits', () => {
    const both = networks('192.168.64.0/24,100.64.0.0/10');
    expect(admits('100.127.255.1', both)).toBe(true);
    expect(admits('100.128.0.1', both)).toBe(false);
  });
});
