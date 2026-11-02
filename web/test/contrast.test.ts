import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { contrast, failing, readTokens, rgb, tokens } from '../../scripts/contrast';

const design = readFileSync(fileURLToPath(new URL('../../design/DESIGN.md', import.meta.url)), 'utf8');

describe('contrast', () => {
  test('is the WCAG ratio', () => {
    expect(contrast(rgb('#FFFFFF'), rgb('#000000'))).toBe(21);
    expect(contrast(rgb('#E67E80'), rgb('#343F44')).toFixed(2)).toBe('3.95');
  });

  test('reads tokens from the stylesheet and names a pair that fails', () => {
    const values = readTokens('--gf-human: #E67E80; --gf-raised: #343F44;');
    expect(values).toEqual({ human: '#E67E80', raised: '#343F44' });
    expect(failing({ ...tokens(), ...values })).toContain('human on raised');
  });
});

describe('the design system', () => {
  test('every pair the text-safe rule holds clears 4.5:1 (DESIGN.md Colors)', () => {
    expect(failing(tokens())).toEqual([]);
  });

  test("DESIGN.md's frontmatter and Colors section carry the hexes tokens.css does", () => {
    const frontmatter = design.slice(design.indexOf('\ncolors:'), design.indexOf('\ntypography:'));
    const inFrontmatter = [...frontmatter.matchAll(/^ {2}([a-z0-9-]+): "(#[0-9A-Fa-f]{6})"$/gm)].map((m) => [m[1], m[2]]);
    const inColors = [...design.matchAll(/^- \*\*([a-z0-9-]+)\*\* \((?:[a-z]+, )?`(#[0-9A-Fa-f]{6})`\)/gm)].map((m) => [m[1], m[2]]);
    const expected = Object.entries(tokens());

    expect(inFrontmatter).toEqual(expected);
    expect(inColors.length).toBeGreaterThanOrEqual(6);
    expect(inColors.filter(([name, hex]) => tokens()[name!] !== hex)).toEqual([]);
  });
});
