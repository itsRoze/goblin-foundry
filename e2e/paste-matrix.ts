/**
 * What a paste has to keep (GF-106), as data: paste shapes, the places in a field to paste them,
 * and the check that every word of the clipboard's text reached what is stored. `zz-paste-words.e2e.ts`
 * runs a small part of it through the real app, since CI's e2e job has no time for more.
 * `scripts/paste-matrix.ts` runs all of it, in Chromium and WebKit.
 */

/** `$` is a word to fill in: a fresh one each time, or one of two (see `withWords`, `withTwoWords`). */
const FRAGMENTS = [
  // words
  '$', '$ $', ' $', '$  ', '  $', '    $', '\t$', '$\\\n$', '$  \n$', '$\n$', '$\r\n$', '$\n\n$', '$é', '日本語 $', '😀 $', '$_$', '$*$', '$*', '*$', '**$',
  // marks
  '**$**', '*$*', '_$_', '__$__', '`$`', '~~$~~', '***$ $***', '**`$`**', '*`$`*', '~~`$`~~', '`` `$` ``', '**$ *$* `$`**',
  // links
  '[$](http://$.y)', '[$](http://$.y "$ $")', '[`$`](http://$.y)', '[**$**](http://$.y)', '[**$** $](http://$.y)', 'http://$.y', 'www.$.y', '$@$.y', '<http://$.y>', '[http://$.y](http://$.y)', '$ http://$.y/$/$ $',
  '![$](http://$.y/$.png)', '![$](http://$.y "$")', '[$][$]', '[$]: http://$.y', '[$]: http://$.y "$"', '[$][r]\n\n[r]: http://$.y', '$[^n]\n\n[^n]: $',
  // headings and quotes
  '# $', '###### $', '# ', '$\n===', '$\n---', '> $', '> $\n> $', '>$', '> ', '> # $', '> - $', '> 1. $', '>1. ', '>1. \n$', '> ```\n> $\n> ```',
  // lists
  '- $', '- $\n- $', '* $', '+ $', '1. $', '1. $\n2. $', '2) $', '1. ', '1.', '- ', '* ', '- [ ] ', '- [x] $', '- [ ] $\n- [x] $', '- # $', '- > $', '1. - $', '- 1. $', '- ## $', '- ```\n  $\n  ```', '- ---', '1. # $', '- [ ] # $', '  - $', '- $\n  - $\n    - $', '-\n  $', '- $\n\n  $', '- # $\n- $', '- $\n- # $',
  // code
  '```\n$\n```', '```$\n$\n```', '```', '```\n$', '~~~\n$\n~~~', '~~~$\n$', '````\n```\n$\n```\n````', '```$```', '``` $ ``` $', '- ```$``` $', '> ```$``` $',
  // rules
  '---', '***', '___',
  // tables, which the schema has no node for
  '| $ | $ |\n|---|---|\n| $ | $ |', '$ | $\n---|---\n$ | $', '| $ |\n|---|', '    | $ |\n    |---|', '$\n| $ |\n|---|', 'see http://$.y now\n    | $ |\n    |---|', '- $\n  - | $ |\n    |---|',
  // html
  '<b>$</b>', '<b>$</b> $', '<div>$</div>', '<div>\n$\n</div>', '<!-- $ -->', '<!-- $', '<span class="$">$</span>', '<a href="http://$.y">$</a>', '<img src="http://$.y" alt="$">', '<$>', '</$>', '<br>', '<script>$</script>', '<details><summary>$</summary>$</details>', '<table><tr><td>$</td></tr></table>', '<?$ $?>', '<!$ $>', '<![CDATA[$]]>',
  // escapes and entities
  '\\*$\\*', '\\# $', '\\[$\\]', '&amp;', '&amp; $', '&#65; $', '&$;', '| &$; |\n|---|',
  // numbers that say more than a list's order
  '2024. $', '3. $\n4. $', '1984. $\n1776. $', '1. $\n3. $', '1. $\n1. $\n1. $',
  // words that are not letters
  '😀', '| 😀 | 🎉 |\n|---|---|', '# 😀\n\n| 🎉 |\n|---|', '| 🇺🇸 | → | ✓ | ★ | € |\n|---|---|---|---|---|', '$ → $ ✓',
  // real words the same as a list number, a box or a URL's words, which a check that takes off the first such word takes off in the wrong place
  '$ 1 $\n\n1. $\n2. $', '$ 2\n\n1. $\n2. $', 'x $\n\n- [x] $', '$ x\n- [x] $', 'http://$.y $\n\n[http://$.y](http://$.y)', '$ 1\n1. $', '3. $\n4. $\n\n1. $\n2. $',
  // a link whose words are marked differently
  '[$ **$** $](http://$.y)', '[*$* $ `$`](http://$.y)',
] as const;

/** Where a word is held twice or a line reads differently once flattened: each row here is how a word has been lost before. */
const LOST_BEFORE = [
  'Docs: http://x.y/name/value\n    | name | value |\n    |------|-------|',
  'see http://secret.y now\n    | secret |\n    |---|',
  'http://secret.y\n\n- a\n  - | secret |\n    |---|',
  '- a\n  - | secret |\n    |---|\n\n<secret>',
  '```\n<secret>\n1. beta\n```\n[secret]: #',
  'http://secret.y\n\n| secret |\n|---|',
  '[secret](http://secret.y)\n\n| secret |\n|---|',
  'See the [guide][g].\n\n[g]: http://x.y/guide',
  'See the [guide].\n\n[guide]: http://x.y/guide',
  '# Plan\n\n| step | owner |\n|---|---|\n| one | two |\n\n- then this\n- and that\n\n```js\nthe code\n```',
  '```\n1. a\n2. b\n```\n\n| 1 | 2 |\n|---|---|',
  'foo\n2. bar\n\n| 2 |\n|---|',
  '1. a\n2. b\n\n| 1 | 2 |\n|---|---|',
  '```\n- [x] a\n```\n\n| x |\n|---|',
  '- [x] a\n\n| x |\n|---|',
  '1. [x] a\n\n| x |\n|---|',
  '&amp;copy;\n\n| copy |\n|---|',
  '&amp;#65;\n\n| 65 |\n|---|',
  '`&amp;`\n\n| amp |\n|---|',
  '```\n[a](a)\n```\n\n| a |\n|---|',
  '[a.b](http://a.b)\n\n| a |\n|---|',
  '[x] [x]\n\n[x]: http://x.y\n\n| y |\n|---|',
  '[x]: http://x.y\n\n[x] [x]\n\n| y |\n|---|',
  '- 1. a\n\n| 1 |\n|---|',
  '- 1.\n\n| 1 |\n|---|',
  '&lt;a href="http://w1.y"&gt;w2&lt;/a&gt;\n\n| w2 |\n|---|',
  '&lt;a href="http://w1.y"&gt;w2&lt;/a&gt;\n\n| lt |\n|---|',
  // words that repeat a marker's, where the paste's words are real ones
  'Version 2 notes\n\n1. one\n2. two',
  'Go to https://example.com/?x=1\n\n- [x] checked it',
  'See [the **new** guide](https://example.com/guide).',
  '1 more\n\n1. a\n2. b\n\n| 1 |\n|---|',
  'x\n\n- [x] a\n\n| x |\n|---|',
  'https://a.b/c\n\n[https://a.b/c](https://a.b/c)\n\n| a | b | c |\n|---|---|---|',
  '### Describe the bug\n\nAfter 2 days the cursor jumps to row 1.\n\n1. Go to https://example.com/board?x=1\n2. Press `j`\n\n- [x] I searched the issues\n- [ ] I can reproduce it on `main`\n\nSee [the **new** guide](https://example.com/guide) and https://example.com/docs.',
];

const SEPARATORS = ['', '\n', '\n\n', ' '];

type Shape = 'block' | 'inline';
export type Place = 'start' | 'middle' | 'end' | 'over part' | 'over all';
export type Position = { shape: Shape; host: string; place: Place };

const HOSTS: Record<Shape, string[]> = {
  block: ['', 'hello world', 'one\n\ntwo', '- aa\n- bb', '1. aa\n2. bb', '> quote', '# head', '```\ncode\n```', '- [ ] task', '**bold** rest', '[link](https://h.z) rest', '---', '- aa\n  - bb\n\n> quote'],
  inline: ['', 'hello world', 'one\n\ntwo', '**bold** rest', '`code` rest', '[link](https://h.z) rest'],
};

const PLACES: Place[] = ['start', 'middle', 'end', 'over part', 'over all'];

const POSITIONS: Position[] = (['block', 'inline'] as const).flatMap((shape) =>
  HOSTS[shape].flatMap((host) => PLACES.map((place) => ({ shape, host, place }))),
);

/** A generator of its own, so a run is the same matrix every time and in both engines. It picks by the high bits: the low bits of this generator repeat with a short period, which made most of the pairs the same few. */
function random(seed: number) {
  return (below: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return Math.floor((seed / 2 ** 32) * below);
  };
}

const withWords = (shape: string): string => {
  let word = 0;
  return shape.replace(/\$/g, () => `w${(word += 1)}`);
};

/** Two words over and over, so a word held twice somewhere can stand in for one lost elsewhere, and only a count in order sees it. */
const withTwoWords = (shape: string): string => {
  let word = 0;
  return shape.replace(/\$/g, () => `w${(word += 1) % 2}`);
};

/** Words a list number, a box or a URL also writes, so a check that takes a marker off by its word takes off the wrong one. */
const withMarkerWords = (shape: string): string => {
  let word = 0;
  return shape.replace(/\$/g, () => ['1', 'x', 'y', '2', 'http'][(word += 1) % 5]!);
};

export type Row = Position & { paste: string };

const PAIRS = 4000;
const POSITIONS_PER_PAIR = 8;

/** Every single shape at every position, then sampled joins of two shapes, each at sampled positions. */
export function matrix(): Row[] {
  const pick = random(106);
  const singles = [...FRAGMENTS.map(withWords), ...LOST_BEFORE];
  const rows: Row[] = singles.flatMap((paste) => POSITIONS.map((position) => ({ ...position, paste })));
  for (let i = 0; i < PAIRS; i += 1) {
    const fill = [withWords, withTwoWords, withWords, withMarkerWords][i % 4]!;
    const paste = fill(FRAGMENTS[pick(FRAGMENTS.length)]! + SEPARATORS[pick(SEPARATORS.length)]! + FRAGMENTS[pick(FRAGMENTS.length)]!);
    for (let j = 0; j < POSITIONS_PER_PAIR; j += 1) rows.push({ ...POSITIONS[pick(POSITIONS.length)]!, paste });
  }
  return rows;
}

/** Letters, numbers, pictures, flags and any symbol past ASCII: `→` and `€` are words, `|` is markup. */
const wordsIn = (text: string) => text.match(/(?:[\p{L}\p{M}\p{N}\p{Extended_Pictographic}\p{RI}]|(?![\0-\x7f])\p{S})+/gu) ?? [];

const counted = (text: string) => {
  const counts = new Map<string, number>();
  for (const word of wordsIn(text)) counts.set(word, (counts.get(word) ?? 0) + 1);
  return counts;
};

/** An autolink stores its URL twice, as its text and its target, and that is one word held, not two. */
const oneAutolink = (markdown: string) => markdown.replace(/\[([^\]\n]*)\]\((?:https?:\/\/|mailto:)?\1\)/g, ' $1 ');

/**
 * A list's order and a task's box are how text is written, not its words: `1. a` in an inline field is `a`. A box has a space after it, so `- [x](url)` is a link. Taken
 * off both sides, line by line and outside fences, with no help from the parser, so a list number in what is stored
 * does not stand in for the same number lost elsewhere. A number that is not 1 or the next in a run from 1 stays.
 */
export function withoutMarkers(text: string, side: 'pasted' | 'stored' = 'stored'): string {
  // pasted, a bare `1.` is an empty list item; stored, an empty item is written `1. ` and a bare `1.` is text
  const afterMarker = side === 'pasted' ? '(?:[ \\t]+|$)' : '[ \\t]+';
  let fenced = false;
  // a run of numbers is in order at its own indent: `1. a\n   2. b` nests a list from 2
  const last = new Map<number, number>();
  return text
    .split(/\r?\n/)
    .map((line) => {
      const fence = /^(?:[ \t>]|[-*+][ \t]|\d+[.)][ \t])*(?:`{3,}[^`]*|~{3,}.*)$/.test(line);
      if (fenced) {
        fenced = !fence;
        return line;
      }
      fenced = fence;
      // failing one at the start, a marker that follows an inline tag or a block of html on its line, which the parser takes as a marker too
      const marker = (prefix: string) => new RegExp(`^(${prefix}[ \\t]*(?:[-*+][ \\t]+)*)(\\d+)[.)]${afterMarker}`).exec(line);
      const number = marker('[ \\t>]*') ?? marker('[^`]*>');
      const indent = number?.[1]?.length ?? 0;
      const inOrder = number && (Number(number[2]) === 1 || Number(number[2]) === (last.get(indent) ?? 0) + 1);
      last.set(indent, inOrder ? Number(number[2]) : 0);
      return (inOrder ? number[1]! + line.slice(number[0].length) : line).replace(/^((?:[^`]*>)?[ \t]*[-*+][ \t]+)\[[xX]\](?=[ \t]|$)/, '$1');
    })
    .join('\n');
}

const ESCAPED: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&amp;': '&' };

/** What the serialiser escapes is not a word in what is stored: `<b>` is written `&lt;b&gt;`, once, since a pasted `&lt;` is written `&amp;lt;`. Code is written as it is, so a fence and a code run are left alone. */
function withoutEscapes(stored: string): string {
  let fenced = false;
  return stored
    .split('\n')
    .map((line) => {
      const fence = /^[ \t>]*(?:[-*+]|\d+[.)])?[ \t]*(?:`{3,}[^`]*|~{3,}.*)$/.test(line);
      if (fenced || fence) {
        fenced = fenced !== fence;
        return line;
      }
      return line
        .split(/(`+[^`]*`+)/)
        .map((part) => (part.startsWith('`') ? part : part.replace(/&(?:lt|gt|amp);/g, (entity) => ESCAPED[entity]!)))
        .join('');
    })
    .join('\n');
}

/**
 * The words of `pasted` that `stored` does not hold as many times as it was pasted, or holds out of the order it was
 * pasted in. Empty is the only pass. `shown` is a field's text as the page draws it, with no markdown to read.
 */
export function wordsLost(pasted: string, stored: string, form: 'markdown' | 'shown' = 'markdown'): string[] {
  const written = form === 'shown' ? stored : withoutEscapes(oneAutolink(withoutMarkers(stored)));
  const words = oneAutolink(withoutMarkers(pasted, 'pasted'));
  const held = counted(written);
  const short = [...counted(words)].filter(([word, times]) => (held.get(word) ?? 0) < times).map(([word]) => word);
  if (short.length > 0) return short;
  const inOrder = wordsIn(words);
  let next = 0;
  for (const word of wordsIn(written)) if (word === inOrder[next]) next += 1;
  return inOrder.slice(next);
}
