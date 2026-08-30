import { StarterKit } from '@tiptap/starter-kit';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Markdown, MarkdownManager } from '@tiptap/markdown';
import type { AnyExtension, JSONContent } from '@tiptap/core';

/**
 * The markdown seam (ADR-0005). Markdown is the only stored form, so the
 * editor's schema *is* the document format: what the schema cannot model does
 * not survive an edit. Parsing and serialising live here, apart from React, so
 * the canonical form can be tested without a browser.
 */

/**
 * Two configurations of one editor. `block` is a document — ticket
 * descriptions and both Designs; `inline` is a sentence or two with emphasis,
 * code and links — App and Project descriptions.
 */
export type EditorShape = 'block' | 'inline';

/** No tables (spec), and no slash menu: input rules are the whole authoring surface. */
const blockKit = () => StarterKit.configure({ link: { openOnClick: false } });

/** Everything that would make a second kind of block is off, so an inline field stays one. */
const inlineKit = () =>
  StarterKit.configure({
    heading: false,
    blockquote: false,
    codeBlock: false,
    horizontalRule: false,
    hardBreak: false,
    bulletList: false,
    orderedList: false,
    listItem: false,
    listKeymap: false,
    link: { openOnClick: false },
  });

export const extensionsFor = (shape: EditorShape): AnyExtension[] =>
  shape === 'block' ? [blockKit(), TaskList, TaskItem, Markdown] : [inlineKit(), Markdown];

const managers = new Map<EditorShape, MarkdownManager>();

/** The parser/serialiser pair for a shape. Extensions never change, so one manager each is enough. */
function managerFor(shape: EditorShape): MarkdownManager {
  let manager = managers.get(shape);
  if (!manager) {
    manager = new MarkdownManager({ extensions: extensionsFor(shape) });
    managers.set(shape, manager);
  }
  return manager;
}

const FENCE = /^\s*(?:```|~~~)/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const BLOCK_MARKER = /^\s*(?:#{1,6}\s+|>\s?|(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)/;

/**
 * Block syntax an inline field cannot hold, reduced to the words inside it.
 * Without this a pasted list would parse into nodes the inline schema has no
 * renderer for and come back empty — silently losing what you pasted is worse
 * than losing the bullets.
 */
export const flattenBlocks = (markdown: string): string =>
  markdown
    .split('\n')
    .filter((line) => !FENCE.test(line) && !RULE.test(line))
    .map((line) => line.replace(BLOCK_MARKER, ''))
    .join('\n');

/** Markdown in, editor document out. The inline shape flattens first (see `flattenBlocks`). */
export const toDoc = (shape: EditorShape, markdown: string): JSONContent =>
  managerFor(shape).parse(shape === 'inline' ? flattenBlocks(markdown) : markdown);

/** Editor document in, markdown out. */
export const toMarkdown = (shape: EditorShape, doc: JSONContent): string => managerFor(shape).serialize(doc);

/**
 * What this field would store for the given markdown. Fidelity is an
 * *idempotent canonical form*, not byte preservation (spec): the first save
 * may normalise what an agent wrote into the editor's dialect, and every save
 * after that is byte-stable. Raw HTML has no place in the schema, so it
 * survives only as the literal text of itself and is never rendered as markup.
 */
export const canonical = (shape: EditorShape, markdown: string): string => toMarkdown(shape, toDoc(shape, markdown));
