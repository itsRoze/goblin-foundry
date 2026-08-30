import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorState } from '@tiptap/pm/state';
import type { Node } from '@tiptap/pm/model';
import { INLINE_MARKS } from './markdown';

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
function touchedRuns(block: Node, blockPos: number, mark: string, from: number, to: number) {
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

/**
 * The run of `mark` whose revealed marker sits right at `pos` — the caret is
 * against the opening one or just past the closing one — or `null`. What the
 * decorations draw and what `backspace` deletes have to be the same thing, so
 * both ask this.
 */
export function markerAt(state: EditorState, mark: string, pos: number): [number, number] | null {
  const $pos = state.doc.resolve(pos);
  if (!$pos.parent.isTextblock) return null;
  for (const [start, end] of touchedRuns($pos.parent, $pos.before($pos.depth), mark, pos, pos)) if (pos === start || pos === end) return [start, end];
  return null;
}

function decorate(state: EditorState): DecorationSet {
  const { from, to } = state.selection;
  const decorations: Decoration[] = [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true;
    // a fence has no marks to reveal, and its ``` would take two lines the block does not have room for
    if (node.type.spec.code) return false;
    for (const { name, token: text } of INLINE_MARKS)
      for (const [start, end] of touchedRuns(node, pos, name, from, to)) {
        decorations.push(Decoration.widget(start, () => token(text), { side: -1, key: `${name}:${start}:open` }));
        decorations.push(Decoration.widget(end, () => token(text), { side: 1, key: `${name}:${end}:close` }));
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
