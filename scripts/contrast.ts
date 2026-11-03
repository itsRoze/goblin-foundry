#!/usr/bin/env bun
/**
 * DESIGN.md's text-safe rule as arithmetic, over the values in design/tokens.css.
 *
 *   bun scripts/contrast.ts      prints every text colour on every surface; exits 1 if a held pair is under 4.5:1
 *
 * web/test/contrast.test.ts holds the same line for CI. `--gf-dim` is absent on purpose: it carries no words.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Rgb = readonly [number, number, number];

const TEXT = ['ink', 'mute', 'system', 'human', 'live', 'draft', 'review', 'link'] as const;
const SURFACES = ['page', 'tile', 'raised', 'rule', 'rule-2'] as const;

/**
 * What the text-safe rule holds: every text colour on the three surfaces, drawn there today or not, because
 * a colour moves. The steps above `--gf-raised` are not text surfaces, so each pair on one names the place that draws it.
 */
const HELD: ReadonlyArray<readonly [text: string, surface: string]> = [
  ...TEXT.flatMap((text) => (['page', 'tile', 'raised'] as const).map((surface) => [text, surface] as const)),
  ['system', 'rule'], // the head of the column under a drag
  ['ink', 'rule'], // that head's count
  ['ink', 'rule-2'], // the filter picker's highlighted row
];

const linear = (channel: number) => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: Rgb) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

export function contrast(a: Rgb, b: Rgb): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const channel = (hex: string, at: number) => Number.parseInt(hex.slice(at, at + 2), 16);
export const rgb = (hex: string): Rgb => [channel(hex, 1), channel(hex, 3), channel(hex, 5)];

export function readTokens(css: string): Record<string, string> {
  return Object.fromEntries([...css.matchAll(/--gf-([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1], m[2]]));
}

export const tokens = () => readTokens(readFileSync(join(__dirname, '../design/tokens.css'), 'utf8'));

const ratio = (values: Record<string, string>, text: string, surface: string) => contrast(rgb(values[text]!), rgb(values[surface]!));

/** The held pairs under 4.5:1, as `text on surface`. */
export function failing(values: Record<string, string>): string[] {
  return HELD.filter(([text, surface]) => ratio(values, text, surface) < 4.5).map(([text, surface]) => `${text} on ${surface}`);
}

// not `import.meta.main`: the browser suite imports this file too, and Playwright loads it as CommonJS
if (require.main === module) {
  const values = tokens();
  const held = new Set(HELD.map((pair) => pair.join(' ')));
  console.log(['', ...SURFACES].map((s) => s.padEnd(9)).join(''));
  for (const text of TEXT) {
    const cells = SURFACES.map((surface) => {
      const cell = ratio(values, text, surface).toFixed(2);
      return (held.has(`${text} ${surface}`) ? cell : `(${cell})`).padEnd(9);
    });
    console.log([text.padEnd(9), ...cells].join(''));
  }
  console.log('(n) is a pair the rule does not hold: nothing draws it, and it may be under 4.5:1.');
  const failures = failing(values);
  if (failures.length > 0) {
    console.error(`under 4.5:1: ${failures.join(', ')}`);
    process.exit(1);
  }
}
