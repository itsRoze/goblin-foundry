import { Extension } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { MarkdownManager } from '@tiptap/markdown';
import { RevealSyntax, markPending, markerAt, markerBehindCaret } from './reveal';
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

/**
 * A link opens when clicked, because this field is the read view as well as the
 * editor (ADR-0005) — a link you cannot follow is a link that does not work.
 * The caret reaches one by arrowing in from either side, and the mode line's
 * `link` acts on the whole run from anywhere inside it.
 */
const LINK = { openOnClick: true, defaultProtocol: 'https' } as const;

/** No tables (spec), and no slash menu: input rules are the whole authoring surface. */
const blockKit = () => StarterKit.configure({ link: LINK });

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
    link: LINK,
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
 * Arrowing across a run's edge, the way an editor that shows its markdown has
 * to (the model `prosemirror-codemark` established): a run `` `test` `` has
 * four positions you can see — outside the opening marker, inside it, inside
 * the closing one, outside it — and only two the document knows about. So at
 * an edge the arrow does not move the caret; it steps the caret across the
 * marker by turning the mark on or off for whatever you type next, and the
 * marker swaps sides to show where you now are. Everywhere else it is an
 * ordinary arrow.
 *
 * This is what makes a run that opens a block escapable at all: there is no
 * position to its left to arrow into, so without this the caret can never get
 * out from under the mark.
 */
function stepMark(editor: Editor, towards: 'left' | 'right'): boolean {
  const { state } = editor;
  const { empty, $from } = state.selection;
  if (!empty) return false;
  for (const { name } of [...INLINE_MARKS].reverse()) {
    const type = state.schema.marks[name];
    const run = type && markerAt(state, name, $from.pos);
    if (!run) continue;
    const pending = markPending(state, name);
    // stepping in at the edge you are arriving at, and out at the edge you are leaving by
    const inward = towards === 'left' ? $from.pos === run[1] : $from.pos === run[0];
    if (pending === inward) continue;
    const marks = state.storedMarks ?? $from.marks();
    return editor.commands.command(({ tr, dispatch }) => {
      if (dispatch) dispatch(tr.setStoredMarks(inward ? type.create().addToSet(marks) : marks.filter((m) => m.type !== type)));
      return true;
    });
  }
  return false;
}

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
      // the four visual positions a run's edges have, and the two document positions they share (see `stepMark`)
      ArrowLeft: () => stepMark(this.editor, 'left'),
      ArrowRight: () => stepMark(this.editor, 'right'),
      Backspace: () => {
        const { state } = this.editor;
        const { $from } = state.selection;
        // innermost first: nested runs draw their markers outside-in, so the one against the caret is the last of them
        for (const { name } of [...INLINE_MARKS].reverse()) {
          const run = markerBehindCaret(state, name);
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

/** Leaves out TipTap's `Markdown` extension: it builds a `MarkdownManager` per editor, and each adds its tokenizers to marked's global list for good. `managerFor` does the parsing. */
export const extensionsFor = (shape: EditorShape): AnyExtension[] =>
  shape === 'block' ? [blockKit(), TaskList, TaskItem, WholeMarks, OpenFence, RevealSyntax] : [inlineKit(), WholeMarks, RevealSyntax];

/**
 * marked's quote tokenizer re-reads a list it finds last in a quote, with the
 * line after the quote appended, through marked's own list tokenizer alone. The
 * numbered-list tokenizer from `@tiptap/extension-list` reads `1. ` and `1. \na`
 * as lists where marked's does not, so for `>1. \na` that re-read got nothing
 * back and marked died reading its `raw` (GF-100). `instance` is marked's one
 * global, the same one the managers register their tokenizers into.
 */
function readListsAsLexed(instance: MarkdownManager['instance']): void {
  const markedList = new instance.Tokenizer().list;
  instance.use({
    tokenizer: {
      list(src) {
        const list = markedList.call(this, src);
        if (list) return list;
        for (const tokenize of this.lexer.options.extensions?.block ?? []) {
          const token = tokenize.call(this, src, []);
          if (token?.type === 'list') return token as NonNullable<typeof list>;
        }
        return list;
      },
    },
  });
}

const managers = new Map<EditorShape, MarkdownManager>();

/** The parser/serialiser pair for a shape. Extensions never change, so one manager each is enough. */
export function managerFor(shape: EditorShape): MarkdownManager {
  let manager = managers.get(shape);
  if (!manager) {
    manager = new MarkdownManager({ extensions: extensionsFor(shape) });
    if (managers.size === 0) readListsAsLexed(manager.instance);
    managers.set(shape, manager);
  }
  return manager;
}

/** The parser hands back a list item with nothing in it for `1. `, where the schema says one opens with a paragraph, and the serialiser reads the child that is not there (GF-100). */
function fillEmptyItem(json: JSONContent): JSONContent {
  if (json.content?.length) return { ...json, content: json.content.map(fillEmptyItem) };
  return json.type === 'listItem' ? { ...json, content: [{ type: 'paragraph' }] } : json;
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

/** Markdown in, the blocks it holds out, an empty list item filled (see `fillEmptyItem`). The inline shape flattens first (see `flattenBlocks`). */
export const toBlocks = (shape: EditorShape, markdown: string): JSONContent[] =>
  (managerFor(shape).parse(shape === 'inline' ? flattenBlocks(markdown) : markdown).content ?? []).map(fillEmptyItem);

/**
 * Markdown in, editor document out. Empty markdown parses to a document with no block, which
 * the schema forbids and ProseMirror opens with no text position, so the caret has nowhere to
 * land (GF-73).
 */
export const toDoc = (shape: EditorShape, markdown: string): JSONContent => {
  const blocks = toBlocks(shape, markdown);
  return { type: 'doc', content: blocks.length ? blocks : [{ type: 'paragraph' }] };
};

const isBlankParagraph = (node: JSONContent): boolean => node.type === 'paragraph' && !node.content?.length;

/**
 * Editor document in, markdown out. Empty paragraphs at either end of the
 * document are not content: the editor puts one below a closing list, heading,
 * fence or quote so a click has somewhere to land, and arrowing out of a fence
 * makes one above or below. Markdown has no form for them, so they are dropped
 * here rather than serialised as blank lines a field would then save (GF-43).
 */
export const toMarkdown = (shape: EditorShape, doc: JSONContent): string => {
  const blocks = doc.content ?? [];
  let start = 0;
  let end = blocks.length;
  while (start < end && isBlankParagraph(blocks[start]!)) start += 1;
  while (end > start && isBlankParagraph(blocks[end - 1]!)) end -= 1;
  return managerFor(shape).serialize({ ...doc, content: blocks.slice(start, end) });
};

/**
 * What this field would store for the given markdown. Fidelity is an
 * *idempotent canonical form*, not byte preservation (spec): the first save
 * may normalise what an agent wrote into the editor's dialect, and every save
 * after that is byte-stable. Raw HTML has no place in the schema, so it
 * survives only as the literal text of itself and is never rendered as markup.
 */
export const canonical = (shape: EditorShape, markdown: string): string => toMarkdown(shape, toDoc(shape, markdown));
