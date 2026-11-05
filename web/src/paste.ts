import type { JSONContent } from '@tiptap/core';
import type { Schema } from '@tiptap/pm/model';
import { flattenBlocks, managerFor, toBlocks, toDoc, toMarkdown, type EditorShape } from './markdown';

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

const wordsIn = (text: string | null | undefined): string[] => text?.match(/[\p{L}\p{M}\p{N}\p{Extended_Pictographic}]+/gu) ?? [];

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

/** Where a document holds a word: its text, a link's URL and title once however many runs the link has, a fence's language, and the numbers of a list. A list from 1 shows only its order, which the pasted side leaves out too (see `wordsOfTheWriting`). */
const wordsHeld = (nodes: JSONContent[]): string[] =>
  nodes.flatMap((node, at) => {
    const link = linkOf(node);
    const before = linkOf(nodes[at - 1]);
    const sameLink = link && before && link.href === before.href && link.title === before.title;
    const ofLink = link && !sameLink ? [isAutolink(node.text, link.href) ? null : link.href, link.title] : [];
    const start = (node.attrs?.start as number | undefined) ?? 1;
    const inside = node.type === 'orderedList' && start !== 1 ? (node.content ?? []).flatMap((item, number) => [String(start + number), ...wordsHeld([item])]) : wordsHeld(node.content ?? []);
    return [...[node.text, node.attrs?.language, ...ofLink].flatMap((words) => wordsIn(words)), ...inside];
  });

type Token = { type: string; raw?: string; text?: string; href?: string; start?: number | ''; ordered?: boolean; checked?: boolean; items?: Token[]; tokens?: Token[]; nestedTokens?: Token[] };

/** Read from what the parser found and not from how a line looks, so a `1.` in a fence or in a paragraph stays a word: the order of a list from 1, a task's box, and the second writing of an autolink's URL. */
const wordsOfTheWriting = (tokens: Token[], inItem = false): string[] =>
  tokens.flatMap((token, at) => {
    const own: string[] = [];
    // a list that opens a list item is one the schema has no place for, and it comes back as text, number and all
    if (token.type === 'list' && token.ordered && token.start === 1 && !(inItem && at === 0))
      token.items?.forEach((item, index) => {
        const number = /^\s*(\d+)/.exec(item.raw ?? '')?.[1];
        if (number && (Number(number) === 1 || Number(number) === index + 1)) own.push(number);
      });
    if (token.type === 'taskItem' && token.checked) own.push('x');
    if (token.type === 'link' && token.raw?.startsWith('[') && isAutolink(token.text, token.href ?? '')) own.push(...wordsIn(token.href));
    return [...own, ...wordsOfTheWriting(token.items ?? []), ...wordsOfTheWriting(token.tokens ?? [], token.type === 'list_item'), ...wordsOfTheWriting(token.nestedTokens ?? [])];
  });

/** A link through a definition, `[a][g]` or `[a]`, holds the definition's URL once for every use where the paste wrote it once, and its label nowhere. */
const throughADefinition = (tokens: Token[]): boolean =>
  tokens.some((token) => (token.type === 'link' && token.raw?.startsWith('[') && !token.raw.includes('](')) || throughADefinition([...(token.items ?? []), ...(token.tokens ?? []), ...(token.nestedTokens ?? [])]));

/** A task's box can be written `[X]`, which the parser reads as `[x]`. */
const withTheBoxLowered = (text: string) => text.replace(/^([ \t>]*[-*+][ \t]+)\[X\]/gm, '$1[x]');

/** The words in a document as the next read of it finds them, since that is all a save keeps: the parser drops a table or a definition it reads back, whatever the document held. */
const wordsReadBack = (shape: EditorShape, doc: JSONContent): string[] => wordsHeld(toDoc(shape, toMarkdown(shape, doc)).content ?? []);

/** The words of a paste a reader would call its words, in the order it wrote them. */
function wordsPasted(shape: EditorShape, pasted: string): string[] {
  const written = withTheBoxLowered(pasted);
  const spare = counted(wordsOfTheWriting(managerFor(shape).instance.lexer(written) as Token[]));
  return wordsIn(written).filter((word) => {
    const left = spare.get(word) ?? 0;
    spare.set(word, left - 1);
    return left <= 0;
  });
}

function holdsInOrder(held: string[], words: string[]): boolean {
  let next = 0;
  for (const word of held) if (word === words[next]) next += 1;
  return next === words.length;
}

/**
 * Whether `after` holds, read back, every word of `before` and of the paste. Counted, not looked up, and the paste's
 * in the order it wrote them: a word in a URL or in a fence does not vouch for the same word lost in a table, and a
 * link used twice holds its definition's URL twice where it was pasted once.
 */
export function keepsEveryWord(shape: EditorShape, before: JSONContent, after: JSONContent, pasted: string): boolean {
  const heldAfter = wordsReadBack(shape, after);
  const words = wordsPasted(shape, pasted);
  const held = counted(heldAfter);
  const enough = [...wordsReadBack(shape, before), ...words].every((word) => {
    const left = held.get(word) ?? 0;
    held.set(word, left - 1);
    return left > 0;
  });
  return enough && holdsInOrder(heldAfter, words);
}

const docOf = (content: JSONContent[]): JSONContent => ({ type: 'doc', content });

/**
 * What a paste could insert, the richest first. Each gives up a little of the markdown to keep
 * the words: the parse as a stored body gets it, then an inline field's markers all taken off,
 * then a top-level block at a time, with only the blocks that lose words going in as written
 * (a table, a definition), then all of it as written, and last the bare words, which no parser
 * can misread.
 */
function pasteReadings(schema: Schema, shape: EditorShape, text: string): (() => JSONContent[])[] {
  const flat = shape === 'inline' ? flattenedFully(text.replace(/\r\n?/g, '\n')) : text;
  const parse = (markdown: string) => {
    // read apart, a use and its definition are text and a block of code, which keep every word
    if (throughADefinition(managerFor(shape).instance.lexer(markdown) as Token[])) throw new Error('a link through a definition');
    return toBlocks(shape, markdown).flatMap((block) => nodesTheSchemaHolds(schema, block));
  };
  const readBlock = (raw: string): JSONContent[] => {
    try {
      const blocks = parse(raw);
      if (keepsEveryWord(shape, docOf([]), docOf(blocks), raw)) return blocks;
    } catch {
      // the parser or the serialiser could not read it, which is one more way to lose it
    }
    return asWritten(shape, raw);
  };
  return [
    () => parse(text),
    ...(flat === text ? [] : [() => parse(flat)]),
    () =>
      managerFor(shape)
        .instance.lexer(flat)
        .filter(({ type }) => type !== 'space')
        .flatMap(({ raw }) => readBlock(raw.trimEnd())),
    () => asWritten(shape, text),
    () => asCodeRuns(text),
    // the parser can misread even a code run: `` `- [ ] a` `` in an inline field reads back as a lone backtick
    () => (wordsIn(text).length > 0 ? [{ type: 'paragraph', content: [{ type: 'text', text: wordsIn(text).join(' ') }] }] : []),
  ];
}

/**
 * What to insert for a paste: the first reading of it that keeps every word once it is in the document and read
 * back, or `null` if none does. `tryInsert` says what the document would be, and `null` if the insert refuses.
 * The check is on that document, not the parse: where the caret is decides what fits, and the host's own words
 * count too, since a pasted `<!--` can swallow what follows it.
 */
export function chooseToPaste(schema: Schema, shape: EditorShape, text: string, tryInsert: (blocks: JSONContent[]) => JSONContent | null): JSONContent[] | null {
  // marked's tokenizers are global and a block field's change how an inline field reads, so judge by the read a later view will make
  managerFor('block');
  for (const reading of pasteReadings(schema, shape, text)) {
    try {
      const blocks = reading();
      // the same insert with nothing in it, so a caret in the middle of a word splits that word on both sides of the comparison
      const before = tryInsert(blocks.length > 0 ? [{ type: 'paragraph' }] : []);
      const after = tryInsert(blocks);
      if (before !== null && after !== null && keepsEveryWord(shape, before, after, text)) return blocks;
    } catch {
      // a reading the parser or the serialiser dies on is a reading that loses the words: on to the next
    }
  }
  return null;
}
