import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { Editor, TiptapEditorHTMLElement } from '@tiptap/core';
import { MarkdownField } from '../src/editor';
import { canonical, toMarkdown } from '../src/markdown';
import type { Place, Row } from '../../e2e/paste-matrix';

/** The page `scripts/paste-matrix.ts` drives: the real field, with the server's part played by a save that always lands. */

function placeCaret(editor: Editor, place: Place) {
  const { doc } = editor.state;
  let from = 1;
  let to = 1;
  doc.descendants((node, pos) => {
    if (to === 1 && node.isTextblock && node.content.size > 0) [from, to] = [pos + 1, pos + 1 + node.content.size];
  });
  const middle = from + Math.floor((to - from) / 2);
  const space = doc.textBetween(from, to).indexOf(' ');
  if (place === 'start') editor.commands.setTextSelection(from);
  if (place === 'middle') editor.commands.setTextSelection(middle);
  if (place === 'end') editor.commands.setTextSelection(doc.content.size);
  if (place === 'over part') editor.commands.setTextSelection({ from: from + space + 1, to });
  if (place === 'over all') editor.commands.selectAll();
}

let errors: string[] = [];
window.addEventListener('error', (event) => errors.push(event.message));
window.addEventListener('unhandledrejection', (event) => errors.push(String(event.reason)));

const aTick = () => new Promise((done) => setTimeout(done));
let fields = 0;

async function pasteInto(row: Row, box: HTMLElement) {
  errors = [];
  fields += 1;
  const saves: string[] = [];
  const root = createRoot(box);
  flushSync(() =>
    root.render(
      createElement(MarkdownField, {
        id: `ticket/${fields}/description`,
        shape: row.shape,
        value: row.host,
        label: 'field',
        placeholder: '',
        onSave: async (markdown: string) => saves.push(markdown),
        onSaveState: () => {},
      }),
    ),
  );
  let dom = box.querySelector<TiptapEditorHTMLElement>('.gf-doc');
  while (!dom?.editor) {
    await aTick();
    dom = box.querySelector<TiptapEditorHTMLElement>('.gf-doc');
  }
  const editor = dom.editor;
  const before = toMarkdown(row.shape, editor.getJSON());
  dom.focus();
  placeCaret(editor, row.place);
  const data = new DataTransfer();
  data.setData('text/plain', row.paste);
  dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  dom.blur();
  await aTick();
  const stored = saves.at(-1) ?? before;
  let reread = '';
  try {
    reread = canonical(row.shape, stored);
  } catch (error) {
    errors.push(String(error));
  }
  root.unmount();
  return { before, stored, reread, errors };
}

declare global {
  interface Window {
    pasteRows: (rows: Row[]) => Promise<Awaited<ReturnType<typeof pasteInto>>[]>;
  }
}

window.pasteRows = async (rows) => {
  const box = document.body.appendChild(document.createElement('div'));
  const results = [];
  for (const row of rows) results.push(await pasteInto(row, box));
  box.remove();
  return results;
};
