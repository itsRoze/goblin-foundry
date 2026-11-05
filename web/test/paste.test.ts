import { describe, expect, test } from 'bun:test';
import { getSchema, type JSONContent } from '@tiptap/core';
import { canonical, extensionsFor, toDoc, toMarkdown, type EditorShape } from '../src/markdown';
import { chooseToPaste, keepsEveryWord } from '../src/paste';

describe('a paste keeps every word', () => {
  const empty: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };

  /** A paste into an empty field: where the caret is matters too, which only a browser shows (`e2e/zz-paste-words.e2e.ts`). */
  const stored = (shape: EditorShape, pasted: string) => {
    const blocks = chooseToPaste(getSchema(extensionsFor(shape)), shape, pasted, (content) => ({ type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] }));
    return blocks && canonical(shape, toMarkdown(shape, { type: 'doc', content: blocks }));
  };

  test('what parses without losing a word goes in as it always has', () => {
    expect(stored('block', '# Plan\n\n- [x] done\n\n[t](http://x.y "A title") **b**')).toBe('# Plan\n\n- [x] done\n\n[t](http://x.y "A title") **b**');
    expect(stored('inline', '- one\n- two')).toBe('one\ntwo');
    expect(stored('inline', '- ```foo``` bar')).toBe('`foo` bar');
  });

  test('a node the schema refuses gives way to what it holds', () => {
    expect(stored('block', '- # a\n- b')).toBe('# a\n\n- b');
    expect(stored('block', '[`c`](http://x.y) and **`d`**')).toBe('[c](http://x.y) and **d**');
  });

  test('a block the parser has no node for goes in as written, and the blocks around it as usual', () => {
    expect(stored('block', '# Plan\n\n| a | b |\n|---|---|\n\n- then')).toBe('# Plan\n\n```\n| a | b |\n|---|---|\n```\n\n- then');
    expect(stored('inline', 'Plan\n\n| a |\n|---|\n\nthen')).toBe('Plan\n\n`| a |`\n\n`|---|`\n\nthen');
    expect(stored('block', 'See [guide][g].\n\n[g]: http://x.y/guide')).toBe('See \\[guide\\]\\[g\\].\n\n```\n[g]: http://x.y/guide\n```');
    expect(stored('block', '![alt](http://x.y/i.png)')).toBe('```\n![alt](http://x.y/i.png)\n```');
  });

  test('an inline field takes every marker off, not only the first, and a hard break does not join words', () => {
    expect(stored('inline', '- # a')).toBe('a');
    expect(stored('inline', '> 1. a')).toBe('a');
    expect(stored('inline', 'a  \nb')).toBe('a\nb');
    expect(stored('inline', '```js\ncode\n```')).toBe('js\ncode');
  });

  test('text that would close a fence goes in as code runs, without its backticks', () => {
    expect(stored('block', '- | a |\n  |---|\n  ```\n  b')).toBe('`- | a |`\n\n`|---|`\n\n`b`');
    expect(stored('inline', '```a```2) b')).toBe('`a 2) b`');
  });

  test('when even a code run reads back without its words, the bare words go in', () => {
    expect(canonical('inline', '`- [ ] # a`')).toBe('\\`');
    expect(stored('inline', '- [ ] # a\n\n```b```')).toBe('a b');
  });

  test('a paste with no words in it, in the middle of a word, inserts nothing', () => {
    const word = (...texts: string[]): JSONContent => ({ type: 'doc', content: texts.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })) });
    const inTheMiddle = (content: JSONContent[]) => (content.length === 0 ? word('one') : { ...word('o', 'ne'), content: [word('o').content![0]!, ...content, word('ne').content![0]!] });
    expect(chooseToPaste(getSchema(extensionsFor('inline')), 'inline', '- ', inTheMiddle)).toEqual([]);
  });

  test('a word in a fence, in a paragraph or among the entities does not vouch for the same word lost in a table', () => {
    for (const [pasted, kept] of [
      ['```\n1. a\n2. b\n```\n\n| 1 | 2 |\n|---|---|', '```\n| 1 | 2 |\n|---|---|\n```'],
      ['foo\n2. bar\n\n| 2 |\n|---|', '```\n| 2 |\n|---|\n```'],
      ['1. a\n2. b\n\n| 1 | 2 |\n|---|---|', '```\n| 1 | 2 |\n|---|---|\n```'],
      ['```\n- [x] a\n```\n\n| x |\n|---|', '```\n| x |\n|---|\n```'],
      ['1. [x] a\n\n| x |\n|---|', '```\n| x |\n|---|\n```'],
      ['&amp;copy;\n\n| copy |\n|---|', '```\n| copy |\n|---|\n```'],
      ['```\n[a](a)\n```\n\n| a |\n|---|', '```\n| a |\n|---|\n```'],
    ] as const)
      expect(stored('block', pasted)).toContain(kept);
  });

  test('nothing the document holds twice vouches for a word it lost', () => {
    for (const [pasted, kept] of [
      ['[x] [x]\n\n[x]: http://x.y\n\n| y |\n|---|', '| y |'],
      ['[x]: http://x.y\n\n[x] [x]\n\n| y |\n|---|', '| y |'],
      ['- 1. a\n\n| 1 |\n|---|', '| 1 |'],
      ['- 1.\n\n| 1 |\n|---|', '| 1 |'],
      ['&lt;a href="http://w1.y"&gt;w2&lt;/a&gt;\n\n| w2 |\n|---|', '| w2 |'],
    ] as const)
      expect(stored('block', pasted)).toContain(kept);
    expect(stored('inline', '&lt;a href="http://w1.y"&gt;w2&lt;/a&gt;\n\n| w2 |\n|---|')).toContain('| w2 |');
  });

  test('a link written out as its own URL is one URL, as what is stored writes it', () => {
    expect(stored('block', '[www.x.y](http://www.x.y) and [http://a.b](http://a.b)')).toBe('[www.x.y](http://www.x.y) and [http://a.b](http://a.b)');
    expect(stored('block', 'two [a](http://x.y) links [b](http://x.y)')).toBe('two [a](http://x.y) links [b](http://x.y)');
    expect(stored('block', '[guide](http://x.y/guide)')).toBe('[guide](http://x.y/guide)');
  });

  test('a list number that says more than the order is a word, and an entity is a word', () => {
    expect(stored('block', '3. a\n4. b')).toBe('3. a\n4. b');
    expect(stored('block', '1984. a\n1776. b')).toBe('```\n1984. a\n1776. b\n```');
    expect(stored('inline', '2024. was a good year')).toBe('`2024. was a good year`');
    expect(stored('inline', '1. a\n1. b\n1. c')).toBe('a\nb\nc');
    expect(stored('block', '- [X] a')).toBe('- [x] a');
    expect(stored('block', '| &secret; |\n|---|')).toContain('&secret;');
  });

  test('an emoji is a word', () => {
    expect(stored('block', '| 😀 | 🎉 |\n|---|---|')).toContain('😀');
    expect(stored('inline', '- [ ] # a 😀\n\n```b 🎉```')).toBe('a 😀 b 🎉');
  });

  test('a word held in a URL does not vouch for the same word lost in a table', () => {
    const pasted = 'Docs: http://x.y/name/value\n\n| name | value |\n|---|---|';
    expect(keepsEveryWord('block', empty, toDoc('block', pasted), pasted)).toBe(false);
    expect(stored('block', pasted)).toBe('Docs: [http://x.y/name/value](http://x.y/name/value)\n\n```\n| name | value |\n|---|---|\n```');
    expect(stored('inline', 'Docs: http://x.y/name/value\n    | name | value |\n    |------|-------|')).toBe('Docs: [http://x.y/name/value](http://x.y/name/value)\n    | name | value |\n    |------|-------|');
  });

  test('a document that reads back with fewer words than it holds does not count as holding them', () => {
    const asText: JSONContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '| a |\n|---|' }] }] };
    expect(keepsEveryWord('block', empty, asText, '| a |\n|---|')).toBe(false);
  });
});
