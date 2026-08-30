import { describe, expect, test } from 'bun:test';
import { canonical, toDoc, toMarkdown } from '../src/markdown';

/**
 * The golden fixture: one document holding every construct the block schema
 * models. The contract is not that storage equals what was submitted — it is
 * that the editor's own dialect is a fixed point, so a design an agent wrote
 * normalises once and never drifts again (spec, ADR-0005).
 */
const GOLDEN = `# A design

Some **strong**, some *emphasis*, some \`code\`, and a [link](https://goblin.dev).

## Slices

- one
- two
  - nested

1. first
2. second

- [ ] not done
- [x] done

> what it is for

\`\`\`ts
const slice = 1;
\`\`\`
`;

describe('the block editor is markdown in and markdown out', () => {
  test('normalising a document is a fixed point, and keeps every construct the schema models', () => {
    const once = canonical('block', GOLDEN);
    expect(canonical('block', once)).toBe(once);

    for (const construct of ['# A design', '**strong**', '*emphasis*', '`code`', '[link](https://goblin.dev)', '- one', '  - nested', '1. first', '- [ ] not done', '- [x] done', '> what it is for', '```ts'])
      expect(once).toContain(construct);
  });

  test('markdown an agent wrote in another dialect settles on the first save and holds still after it', () => {
    // setext headings, `*` bullets, `_emphasis_`, four-space code — all legal markdown, none of it ours
    const foreign = 'A design\n========\n\n* one\n* two\n\n_why_ it matters\n';
    const once = canonical('block', foreign);
    expect(once).not.toBe(foreign);
    expect(canonical('block', once)).toBe(once);
    expect(once).toContain('# A design');
    expect(once).toContain('- one');
    expect(once).toContain('*why*');
  });

  test('raw HTML is never markup: it comes back as the text of itself, and stays that way', () => {
    const once = canonical('block', 'Hello <script>alert(1)</script> <b>there</b>');
    expect(once).not.toContain('<script>');
    expect(once).toContain('&lt;script&gt;');
    expect(canonical('block', once)).toBe(once);
  });

  test('an empty document is empty markdown, not a stray paragraph', () => {
    expect(canonical('block', '')).toBe('');
  });

  test('a document round-trips through the editor document it is parsed into', () => {
    const doc = toDoc('block', GOLDEN);
    expect(doc.type).toBe('doc');
    expect(toMarkdown('block', doc)).toBe(canonical('block', GOLDEN));
  });
});

describe('the inline editor holds a sentence, not a document', () => {
  test('emphasis, code and links survive; a fixed point again', () => {
    const once = canonical('inline', 'a **b** `c` [d](https://e.dev)');
    expect(once).toBe('a **b** `c` [d](https://e.dev)');
    expect(canonical('inline', once)).toBe(once);
  });

  test('pasted block syntax loses its bullets and headings but never its words', () => {
    const once = canonical('inline', '# Heading\n\n- one\n- two\n\n> quoted\n\n```\ncode\n```\n');
    for (const word of ['Heading', 'one', 'two', 'quoted', 'code']) expect(once).toContain(word);
    expect(once).not.toContain('# Heading');
    expect(once).not.toContain('- one');
    expect(canonical('inline', once)).toBe(once);
  });
});
