import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorState } from '@tiptap/pm/state';

/**
 * Show a mark's markdown around it while the caret is on it.
 *
 * Markdown is what gets stored (ADR-0005), but it is not what the document is:
 * `` `parse` `` is a text node with a mark, and the backticks exist only when
 * the document is serialised. So there is nothing there to put a caret
 * between — these are decorations, drawn beside the run, not characters. They
 * say *where the span begins and ends*, which is the thing a rendered span
 * otherwise hides. Taking the span off is the mode line, or `⌘E`.
 *
 * Same idea as `prosemirror-codemark`, which solves the neighbouring problem
 * (whether the next character you type lands inside the span) with a drawn
 * cursor.
 */

/** The marks whose markdown is a pair of characters around the run. `link` is not one — its URL lives in the mode line. */
const REVEALED: { mark: string; token: string }[] = [
  { mark: 'code', token: '`' },
  { mark: 'bold', token: '**' },
  { mark: 'italic', token: '*' },
  { mark: 'strike', token: '~~' },
];

function token(text: string): HTMLElement {
  const span = document.createElement('span');
  span.className = 'gf-syntax';
  span.textContent = text;
  // it is a label on the text, not part of it: never editable, never spoken, never selectable
  span.contentEditable = 'false';
  span.setAttribute('aria-hidden', 'true');
  return span;
}

/** Runs of `mark` inside `block` that the selection touches, as `[from, to]` pairs. */
function touchedRuns(block: { forEach: (f: (child: { nodeSize: number; marks: readonly { type: { name: string } }[] }, offset: number) => void) => void }, blockPos: number, mark: string, from: number, to: number) {
  const runs: [number, number][] = [];
  let start: number | null = null;
  let end = 0;
  const close = () => {
    // "nearby" is inclusive at both ends, so a caret resting against the span counts as on it
    if (start !== null && from <= end && to >= start) runs.push([start, end]);
    start = null;
  };
  block.forEach((child, offset) => {
    const at = blockPos + 1 + offset;
    if (child.marks.some((m) => m.type.name === mark)) {
      if (start === null) start = at;
      end = at + child.nodeSize;
    } else close();
  });
  close();
  return runs;
}

function decorate(state: EditorState): DecorationSet {
  const { from, to } = state.selection;
  const decorations: Decoration[] = [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true;
    // a fence has no marks to reveal, and its ``` would take two lines the block does not have room for
    if (node.type.spec.code) return false;
    for (const { mark, token: text } of REVEALED)
      for (const [start, end] of touchedRuns(node, pos, mark, from, to)) {
        decorations.push(Decoration.widget(start, () => token(text), { side: -1, key: `${mark}:${start}:open` }));
        decorations.push(Decoration.widget(end, () => token(text), { side: 1, key: `${mark}:${end}:close` }));
      }
    return false;
  });
  return DecorationSet.create(state.doc, decorations);
}

export const RevealSyntax = Extension.create({
  name: 'revealSyntax',
  addProseMirrorPlugins() {
    return [new Plugin({ props: { decorations: decorate } })];
  },
});
