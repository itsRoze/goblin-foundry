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

  test('when even a code run reads back without its words, that block goes in as its bare words, and only that block', () => {
    expect(canonical('inline', '`- [ ] # a`')).toBe('\\`');
    expect(stored('inline', '**one**\n\n`- [ ] a` | b |\n|---|---|')).toBe('**one**\n\na b');
    expect(stored('inline', '- [ ] # a\n\n```b```')).toBe('a\n\n`b`');
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

  test('a word the same as a list number, a box or a URL is a word, and does not cost the paste its marks', () => {
    expect(stored('block', 'Version 2 notes\n\n1. one\n2. two')).toBe('Version 2 notes\n\n1. one\n2. two');
    expect(stored('block', 'Go to https://x.y/?x=1\n\n- [x] checked it')).toBe('Go to [https://x.y/?x=1](https://x.y/?x=1)\n\n- [x] checked it');
    expect(stored('inline', 'Go to https://x.y/?x=1\n\n- [x] checked it')).toBe('Go to [https://x.y/?x=1](https://x.y/?x=1)\n\nchecked it');
    expect(stored('block', 'https://a.b/c is it\n\n[https://a.b/c](https://a.b/c)')).toBe('[https://a.b/c](https://a.b/c) is it\n\n[https://a.b/c](https://a.b/c)');
    expect(stored('block', '1 more\n\n1. a\n2. b\n\n| 1 |\n|---|')).toContain('```\n| 1 |\n|---|\n```');
  });

  test('a link holds its URL after all of its words, however they are marked', () => {
    expect(stored('block', 'See [the **new** guide](http://x.y/guide).')).toBe('See [the **new** guide](http://x.y/guide).');
    expect(stored('inline', 'See [the **new** guide](http://x.y/guide).')).toBe('See [the **new** guide](http://x.y/guide).');
  });

  test('a list that starts again from 1 is a list in order, where a number out of order is a word', () => {
    expect(stored('block', '3. a\n4. b\n\n1. c\n2. d')).toBe('3. a\n4. b\n5. c\n6. d');
    expect(stored('block', '2024. a\n\n1. b')).toBe('2024. a\n2025. b');
    expect(stored('block', '3. a\n1776. b')).toBe('```\n3. a\n1776. b\n```');
  });

  test('a list numbered from above 1 holds its first number and its order, so a number lost beside it is not vouched for', () => {
    for (const pasted of [
      '3. a\n\n   | 4 |\n   |---|\n\n4. b',
      '> 3. a\n>\n>    | 4 |\n>    |---|\n>\n> 4. b',
      '2) a\n\n   | 3 |\n   |---|\n\n3) b',
      '- y\n\n  7. a\n\n     | 8 |\n     |---|\n\n  8. b',
    ])
      expect(stored('block', pasted)).toBe(`\`\`\`\n${pasted}\n\`\`\``);
  });

  test('a list that opens a list item reads back as text, and its numbers in order there do not vouch for one lost in a table', () => {
    // as the browser leaves `- aa` with a paste at its start: the item opens with an empty paragraph, then what was pasted
    const atTheStartOfAnItem = (content: JSONContent[]): JSONContent => ({
      type: 'doc',
      content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }, ...content.filter((node) => node.content), { type: 'paragraph', content: [{ type: 'text', text: 'aa' }] }] }] }],
    });
    for (const pasted of ['3. a\n\n   | 4 |\n   |---|\n\n4. b', '1. a\n\n   | 2 |\n   |---|\n\n2. b']) {
      const blocks = chooseToPaste(getSchema(extensionsFor('block')), 'block', pasted, atTheStartOfAnItem);
      expect(toMarkdown('block', atTheStartOfAnItem(blocks ?? []))).toContain(pasted.includes('4') ? '| 4 |' : '| 2 |');
    }
    // the same numbers in a paste's own text are order there too, so text that is no list still goes in as it is
    expect(stored('block', 'one two\n3. three\n4. four')).toBe('one two\n3. three\n4. four');
    expect(stored('block', '<one>\n3. two\n4. three')).toBe('&lt;one&gt;\n3. two\n4. three');
  });

  test('an x in a box that does not open its line is a word, where a box that does is a task', () => {
    expect(stored('block', '`- [x] a`')).toBe('```\n`- [x] a`\n```');
    expect(stored('block', 'x - [x] a')).toBe('```\nx - [x] a\n```');
    expect(stored('block', '> b - [x] a')).toBe('```\n> b - [x] a\n```');
    expect(stored('block', '> `- [x] a`')).toBe('```\n> `- [x] a`\n```');
    expect(stored('block', '`- [x] done` and `- [ ] todo`')).toBe('```\n`- [x] done` and `- [ ] todo`\n```');
    expect(stored('inline', 'x - [x] a')).toBe('`x - [x] a`');
    expect(stored('block', '> - [x] a\n\n1. - [x] b')).toBe('> - [x] a\n\n1. - \\[x\\] b');
    expect(stored('inline', '- [x] a')).toBe('a');
  });

  test('a block the lexer starts mid-line is read with the block before it', () => {
    expect(stored('inline', '`- [x] a`')).toBe('x a');
    expect(stored('inline', '**one**\n\n`- [x] a`')).toBe('**one**\n\nx a');
  });

  test('a heading an inline field reads and cannot hold does not count as holding its words', () => {
    expect(canonical('inline', '`a` b\n===')).toBe('');
    expect(stored('inline', '> ```a``` b\n===')).toBe('`>  a  b`\n\n`===`');
  });

  test('a flag and a symbol past ASCII are words', () => {
    expect(stored('block', '| 🇺🇸 | → | ✓ | ★ | € |\n|---|---|---|---|---|')).toBe('```\n| 🇺🇸 | → | ✓ | ★ | € |\n|---|---|---|---|---|\n```');
  });

  test('an emoji is a word', () => {
    expect(stored('block', '| 😀 | 🎉 |\n|---|---|')).toContain('😀');
    expect(stored('inline', '- [ ] # a 😀\n\n```b 🎉```')).toBe('a 😀\n\n`b 🎉`');
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
