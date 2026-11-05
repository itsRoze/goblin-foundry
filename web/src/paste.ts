import { getSchema, type JSONContent } from '@tiptap/core';
import type { Schema } from '@tiptap/pm/model';
import { extensionsFor, flattenBlocks, managerFor, toBlocks, toDoc, toMarkdown, type EditorShape } from './markdown';

/**
 * What a paste inserts, which is the one place markdown comes in that must keep every word of
 * itself (GF-106). A stored body is read as it is and keeps its bytes. A paste can be refused by
 * the schema where a stored body is not, and the parser drops what it has no node for.
 */

/** The parser lists the outermost mark last. Going from there, a mark that cannot share a run with one kept is dropped: a code link keeps its URL, since `code` excludes every other mark. */
function compatibleMarks(schema: Schema, marks: NonNullable<JSONContent['marks']>) {
  const typeOf = (mark: { type: string }) => schema.marks[mark.type];
  return marks.reduceRight<typeof marks>((kept, mark) => {
    const type = typeOf(mark);
    return type && kept.every((other) => !type.excludes(typeOf(other)!) && !typeOf(other)!.excludes(type)) ? [...kept, mark] : kept;
  }, []);
}

/** A node the schema will not hold gives way to what it holds: `- # a` is a heading, where a list item could not open with one. */
function nodesTheSchemaHolds(schema: Schema, node: JSONContent): JSONContent[] {
  const kept = node.content ? { ...node, content: node.content.flatMap((child) => nodesTheSchemaHolds(schema, child)) } : node;
  try {
    schema.nodeFromJSON(kept).check();
    return [kept];
  } catch {
    return kept.text ? [{ ...kept, marks: compatibleMarks(schema, kept.marks ?? []) }] : (kept.content ?? []);
  }
}

/** `flattenBlocks` until nothing is left to take: every marker on a line, the indent that would read as code, a fence's opening with its language left standing, and the hard break the inline schema has no node for, which joins the words across it. */
const flattenedFully = (markdown: string): string => {
  const flat = flattenBlocks(
    markdown
      .split('\n')
      .map((line) => line.replace(/^[ \t]+/, '').replace(/^(?:`{3,}(?=[^`]*$)|~{3,})/, '').replace(/(?: {2,}|\\)$/, ''))
      .join('\n'),
  );
  return flat === markdown ? flat : flattenedFully(flat);
};

/** Text as a block of code, the one block that holds it as written, unless a line of it would close the fence. */
const asCodeBlock = (text: string): JSONContent[] | null => {
  const written = text.replace(/\r\n?/g, '\n').replace(/^\n+/, '').trimEnd();
  return written === '' || /^\s*```/m.test(written) ? null : [{ type: 'codeBlock', content: [{ type: 'text', text: written }] }];
};

/** Text as a code run a line, which holds it where a block of code cannot go. A run has no way to hold a backtick, so a space takes its place and the words either side stay two, and the serialiser moves a run's outer spaces outside it, where an indent reads as code again. */
const asCodeRuns = (text: string): JSONContent[] =>
  text
    .split(/\r?\n/)
    .map((line) => line.replace(/`+/g, ' ').trim())
    .filter((line) => line !== '')
    .map((line) => ({ type: 'paragraph', content: [{ type: 'text', text: line, marks: [{ type: 'code' }] }] }));

const asWritten = (shape: EditorShape, text: string): JSONContent[] => (shape === 'block' && asCodeBlock(text)) || asCodeRuns(text);

/** A word is a run of letters, numbers, pictures, flags and any symbol past ASCII, so `→`, `✓` and `€` are words where `|` and `*` are markup. */
const wordsIn = (text: string | null | undefined): string[] => text?.match(/(?:[\p{L}\p{M}\p{N}\p{Extended_Pictographic}\p{RI}]|(?![\0-\x7f])\p{S})+/gu) ?? [];

const counted = (words: string[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  return counts;
};

const WRITTEN_URL_PREFIXES = ['', 'http://', 'https://', 'mailto:'];

const ENTITIES: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&amp;': '&' };

/** An autolink's URL is its text and its target, and that is one word held, not two: counted twice, it stands in for a table lost beside it. The parser leaves a target's entities written and decodes the text's. */
const isAutolink = (text: string | undefined, href: string): boolean => {
  const target = href.replace(/&(?:lt|gt|quot|#39|amp);/g, (entity) => ENTITIES[entity]!);
  return text !== undefined && WRITTEN_URL_PREFIXES.some((prefix) => prefix + text === target);
};

const linkOf = (node?: JSONContent) => node?.marks?.find(({ type }) => type === 'link')?.attrs;

/** Where a document holds a word: its text, a link's URL and title once however many runs the link has and after the last of them, as it is written, a fence's language, and the numbers of a list. A list from 1 shows only its order, which the pasted side leaves out too (see `markerSpans`). */
const wordsHeld = (nodes: JSONContent[]): string[] =>
  nodes.flatMap((node, at) => {
    const link = linkOf(node);
    const next = linkOf(nodes[at + 1]);
    const sameLink = link && next && link.href === next.href && link.title === next.title;
    const ofLink = link && !sameLink ? [isAutolink(node.text, link.href) ? null : link.href, link.title] : [];
    const start = (node.attrs?.start as number | undefined) ?? 1;
    const inside = node.type === 'orderedList' && start !== 1 ? (node.content ?? []).flatMap((item, number) => [String(start + number), ...wordsHeld([item])]) : wordsHeld(node.content ?? []);
    return [...[node.text, node.attrs?.language, ...ofLink].flatMap((words) => wordsIn(words)), ...inside];
  });

type Token = { type: string; raw?: string; text?: string; href?: string; start?: number | ''; ordered?: boolean; checked?: boolean; items?: Token[]; tokens?: Token[]; nestedTokens?: Token[] };

let lastLexed: { markdown: string; tokens: Token[] } | null = null;

/** marked's tokens for `markdown`, lexed once for the three questions a paste asks of the same text. The tokenizers are global, so every shape lexes alike. */
function lexed(markdown: string): Token[] {
  if (lastLexed?.markdown !== markdown) lastLexed = { markdown, tokens: managerFor('block').instance.lexer(markdown) as Token[] };
  return lastLexed.tokens;
}

/** Where a token's raw is in the paste, from `from` on. A nested token's lines have lost their indent and quote markers, so a line may have them back. Matched by hand: a raw is as long as the paste, and a pattern that long is one V8 will not compile. */
function locate(written: string, raw: string, from: number): [number, number] | null {
  const [first = '', ...rest] = raw.split('\n').map((line) => line.replace(/^[ \t>]+/, ''));
  // `indexOf('')` never gives -1, so the bound is what ends an empty first line's search
  for (let start = written.indexOf(first, from); start !== -1; start = start < written.length ? written.indexOf(first, start + 1) : -1) {
    let end = start + first.length;
    const matches = rest.every((line) => {
      if (written[end] !== '\n') return false;
      end += 1;
      while (written[end] === ' ' || written[end] === '\t' || written[end] === '>') end += 1;
      if (!written.startsWith(line, end)) return false;
      end += line.length;
      return true;
    });
    if (matches) return [start, end];
  }
  return null;
}

/**
 * Where the paste writes what a document leaves out: the order of a list, a task's box, and the second writing of an
 * autolink's URL. Read from what the parser found and found at its own place, not from how a line looks or from the
 * first word that matches, so a `1.` in a fence and the `2` of `Version 2` above a list both stay words.
 */
function markerSpans(written: string, tokens: Token[]): [number, number][] {
  const spans: [number, number][] = [];
  let cursor = 0;
  const walk = (tokens: Token[], inItem: boolean) =>
    tokens.forEach((token, at) => {
      if (token.type === 'taskItem') {
        // its raw is empty: the box is the next one written
        const box = /[-*+][ \t]+\[([ x])\]/g;
        box.lastIndex = cursor;
        const found = box.exec(written);
        if (found) {
          cursor = found.index + found[0].length;
          if (found[1] === 'x') spans.push([cursor - 2, cursor - 1]);
        }
      }
      const place = token.raw ? locate(written, token.raw, cursor) : null;
      if (place) cursor = place[0];
      // a list that opens a list item is one the schema has no place for, and it comes back as text, number and all
      if (place && token.type === 'list' && token.ordered && !(inItem && at === 0)) {
        let previous = Number.NaN;
        for (const item of token.items ?? []) {
          const where = item.raw && locate(written, item.raw, cursor);
          const number = where && /^\d+/.exec(written.slice(where[0]));
          if (!where || !number) break;
          // a number in order says only that, where `1776` after `1984` says more
          if (Number(number[0]) === 1 || Number(number[0]) === previous + 1) spans.push([where[0], where[0] + number[0].length]);
          previous = Number(number[0]);
          cursor = where[0] + number[0].length;
          walk(item.tokens ?? [], true);
          cursor = Math.max(cursor, where[1]);
        }
      } else if (place && token.type === 'checkbox') {
        // marked's own box, in a list it read before a task list could
        if (token.checked) spans.push([place[0] + 1, place[0] + 2]);
      } else if (place && token.type === 'link' && token.raw?.startsWith('[') && isAutolink(token.text, token.href ?? '')) {
        const target = written.indexOf('](', place[0]);
        if (target !== -1 && target < place[1]) spans.push([target, /[\s)]|$/.exec(written.slice(target + 2))!.index + target + 2]);
      } else walk([...(token.items ?? []), ...(token.tokens ?? []), ...(token.nestedTokens ?? [])], token.type === 'list_item' || token.type === 'taskItem');
      if (place) cursor = Math.max(cursor, place[1]);
    });
  walk(tokens, false);
  return spans;
}

/** A link through a definition, `[a][g]` or `[a]`, holds the definition's URL once for every use where the paste wrote it once, and its label nowhere. */
const throughADefinition = (tokens: Token[]): boolean =>
  tokens.some((token) => (token.type === 'link' && token.raw?.startsWith('[') && !token.raw.includes('](')) || throughADefinition([...(token.items ?? []), ...(token.tokens ?? []), ...(token.nestedTokens ?? [])]));

/** A task's box can be written `[X]`, which the parser reads as `[x]`. */
const withTheBoxLowered = (text: string) => text.replace(/^([ \t>]*[-*+][ \t]+)\[X\]/gm, '$1[x]');

/** The words in a document as the next read of it finds them, since that is all a save keeps: the parser drops a table or a definition it reads back, whatever the document held. */
const wordsReadBack = (shape: EditorShape, doc: JSONContent): string[] => wordsHeld(onlyWhatTheFieldHolds(shape, toDoc(shape, toMarkdown(shape, doc)).content ?? []));

const nodeNames = new Map<EditorShape, Set<string>>();

/** The parser reads `a\n===` as a heading in an inline field too, which has no heading, and the next save writes nothing of it. */
function onlyWhatTheFieldHolds(shape: EditorShape, nodes: JSONContent[]): JSONContent[] {
  if (!nodeNames.has(shape)) nodeNames.set(shape, new Set(Object.keys(getSchema(extensionsFor(shape)).nodes)));
  const names = nodeNames.get(shape)!;
  return nodes.filter(({ type }) => type && names.has(type)).map((node) => (node.content ? { ...node, content: onlyWhatTheFieldHolds(shape, node.content) } : node));
}

/** The words of a paste a reader would call its words, in the order it wrote them. */
function wordsPasted(shape: EditorShape, pasted: string): string[] {
  const written = withTheBoxLowered(pasted.replace(/\r\n?/g, '\n'));
  let words = '';
  let from = 0;
  for (const [start, end] of markerSpans(written, lexed(written)).sort(([a], [b]) => a - b)) {
    words += `${written.slice(from, start)} `;
    from = Math.max(from, end);
  }
  return wordsIn(words + written.slice(from));
}

function holdsInOrder(held: string[], words: string[]): boolean {
  let next = 0;
  for (const word of held) if (word === words[next]) next += 1;
  return next === words.length;
}

/**
 * Whether `held`, a document's words read back, holds every word of `host` and of `pasted`. Counted, not looked up,
 * and the paste's in the order it wrote them: a word in a URL or in a fence does not vouch for the same word lost in
 * a table, and a link used twice holds its definition's URL twice where it was pasted once.
 */
function holdsTheWords(held: string[], host: string[], pasted: string[]): boolean {
  const left = counted(held);
  const enough = [...host, ...pasted].every((word) => {
    const times = left.get(word) ?? 0;
    left.set(word, times - 1);
    return times > 0;
  });
  return enough && holdsInOrder(held, pasted);
}

/** Whether `after` holds, read back, every word of `before` and of the paste. */
export function keepsEveryWord(shape: EditorShape, before: JSONContent, after: JSONContent, pasted: string): boolean {
  return holdsTheWords(wordsReadBack(shape, after), wordsReadBack(shape, before), wordsPasted(shape, pasted));
}

const docOf = (content: JSONContent[]): JSONContent => ({ type: 'doc', content });

/** The words and nothing else, which no parser can misread. */
const asBareWords = (text: string): JSONContent[] => (wordsIn(text).length > 0 ? [{ type: 'paragraph', content: [{ type: 'text', text: wordsIn(text).join(' ') }] }] : []);

/**
 * What a paste could insert, the richest first. Each gives up a little of the markdown to keep
 * the words: the parse as a stored body gets it, then an inline field's markers all taken off,
 * then a top-level block at a time, with only the blocks that lose words going in as written
 * (a table, a definition) and only a block that loses them even so going in as its bare words,
 * then all of it as written.
 */
function pasteReadings(schema: Schema, shape: EditorShape, text: string): (() => JSONContent[])[] {
  const flat = shape === 'inline' ? flattenedFully(text.replace(/\r\n?/g, '\n')) : text;
  const parse = (markdown: string) => {
    // read apart, a use and its definition are text and a block of code, which keep every word
    if (throughADefinition(lexed(markdown))) throw new Error('a link through a definition');
    return toBlocks(shape, markdown).flatMap((block) => nodesTheSchemaHolds(schema, block));
  };
  const readBlock = (raw: string): JSONContent[] => {
    const words = wordsPasted(shape, raw);
    for (const reading of [() => parse(shape === 'inline' ? flattenedFully(raw) : raw), () => asWritten(shape, raw)]) {
      try {
        const blocks = reading();
        if (holdsTheWords(wordsReadBack(shape, docOf(blocks)), [], words)) return blocks;
      } catch {
        // the parser or the serialiser could not read it, which is one more way to lose it
      }
    }
    // the parser can misread even a code run: `` `- [ ] a` `` in an inline field reads back as a lone backtick
    return asBareWords(raw);
  };
  return [
    () => parse(text),
    ...(flat === text ? [] : [() => parse(flat)]),
    () =>
      lexed(text.replace(/\r\n?/g, '\n'))
        .filter(({ type }) => type !== 'space')
        .flatMap(({ raw = '' }) => readBlock(raw.trimEnd())),
    () => asWritten(shape, text),
    () => asCodeRuns(text),
  ];
}

/**
 * What to insert for a paste: the first reading of it that keeps every word once it is in the document and read
 * back, or `null` if none does. `tryInsert` says what the document would be, and `null` if the insert refuses.
 * The check is on that document, not the parse: where the caret is decides what fits, and the host's own words
 * count too, since a pasted `<!--` can swallow what follows it. The read is what costs, so each reading is read
 * once, in place, and the host's words are read once.
 */
export function chooseToPaste(schema: Schema, shape: EditorShape, text: string, tryInsert: (blocks: JSONContent[]) => JSONContent | null): JSONContent[] | null {
  // marked's tokenizers are global and a block field's change how an inline field reads, so judge by the read a later view will make
  managerFor('block');
  const words = wordsPasted(shape, text);
  const hosts = new Map<boolean, string[] | null>();
  // the same insert with nothing in it, so a caret in the middle of a word splits that word on both sides of the comparison
  const hostWords = (pastesAny: boolean) => {
    if (!hosts.has(pastesAny)) {
      const before = tryInsert(pastesAny ? [{ type: 'paragraph' }] : []);
      hosts.set(pastesAny, before && wordsReadBack(shape, before));
    }
    return hosts.get(pastesAny)!;
  };
  for (const reading of pasteReadings(schema, shape, text)) {
    try {
      const blocks = reading();
      if (blocks.length === 0 && words.length > 0) continue;
      const after = tryInsert(blocks);
      const host = hostWords(blocks.length > 0);
      if (after !== null && host !== null && holdsTheWords(wordsReadBack(shape, after), host, words)) return blocks;
    } catch {
      // a reading the parser or the serialiser dies on is a reading that loses the words: on to the next
    }
  }
  return null;
}
