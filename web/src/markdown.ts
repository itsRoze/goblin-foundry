import { Extension } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Markdown, MarkdownManager } from '@tiptap/markdown';
import { RevealSyntax, markerAt } from './reveal';
import type { AnyExtension, Editor, JSONContent } from '@tiptap/core';

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

/**
 * The inline marks whose markdown is a pair of characters around the run.
 * One table, so the mode line's buttons, the keyboard and the syntax the
 * caret reveals cannot drift apart — a mark added here is added everywhere.
 * `link` is not one of them: its markdown wraps the text *and* carries a URL,
 * which is why it has a slot on the mode line instead.
 */
export const INLINE_MARKS = [
  { name: 'bold', token: '**', binding: 'Mod-b', key: '⌘B' },
  { name: 'italic', token: '*', binding: 'Mod-i', key: '⌘I' },
  { name: 'code', token: '`', binding: 'Mod-e', key: '⌘E' },
  { name: 'strike', token: '~~', binding: 'Mod-Shift-x', key: '⌘⇧X' },
] as const;

/**
 * Toggle a mark on the caret's whole span. The backticks around `code` are not
 * in the document, so with nothing selected the only thing you can point at is
 * the span itself: putting the caret in it and asking for `code` means "this
 * one", not "whatever I type next". A real selection is left alone — there you
 * did say what you meant.
 */
export const toggleWholeMark = (editor: Editor, name: string): boolean => {
  const chain = editor.chain().focus();
  return (editor.state.selection.empty ? chain.extendMarkRange(name) : chain).toggleMark(name).run();
};

/**
 * The keys that act on a whole span: `⌘B`/`⌘I`/`⌘E`/`⌘⇧X`, so a key and the
 * mode line's button are one behaviour; and `backspace` against a revealed
 * marker, which deletes the marker — that is, takes the mark off the run.
 * The markers are drawn, so deleting one has to do what deleting it looks
 * like it should; a second press then deletes the character underneath.
 */
const WholeMarks = Extension.create({
  name: 'wholeMarks',
  // ahead of StarterKit's own bindings, which act on the caret rather than the span
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      ...Object.fromEntries(INLINE_MARKS.map(({ name, binding }) => [binding, () => toggleWholeMark(this.editor, name)])),
      Backspace: () => {
        const { state } = this.editor;
        const { empty, $from } = state.selection;
        if (!empty) return false;
        for (const { name } of INLINE_MARKS) {
          const run = markerAt(state, name, $from.pos);
          if (run)
            return this.editor
              .chain()
              .setTextSelection({ from: run[0], to: run[1] })
              .unsetMark(name)
              .setTextSelection($from.pos)
              .run();
        }
        return false;
      },
    };
  },
});

/**
 * A way above a fence that opens the document. A design pasted from a planner
 * often starts with one, and then there is no line above it to click and
 * nothing before it to arrow into — the block's own `exitOnArrowUp` does not
 * fire here. `ArrowUp` at the very start of it opens a paragraph instead.
 */
const OpenFence = Extension.create({
  name: 'openFence',
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      ArrowUp: () => {
        const { $from, empty } = this.editor.state.selection;
        if (!empty || $from.parent.type.name !== 'codeBlock') return false;
        if ($from.parentOffset !== 0 || $from.before() !== 0) return false;
        return this.editor.chain().insertContentAt(0, { type: 'paragraph' }).setTextSelection(1).focus().run();
      },
    };
  },
});

export const extensionsFor = (shape: EditorShape): AnyExtension[] =>
  shape === 'block' ? [blockKit(), TaskList, TaskItem, Markdown, WholeMarks, OpenFence, RevealSyntax] : [inlineKit(), Markdown, WholeMarks, RevealSyntax];

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
