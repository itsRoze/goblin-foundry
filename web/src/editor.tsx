import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { extensionsFor, toDoc, toMarkdown, type EditorShape } from './markdown';

/**
 * The Linear-style editor (spec §Editor). It is also the read view: there is
 * no edit mode and no separate renderer, because markdown is the only stored
 * form (ADR-0005). A field is always live — type into it and it saves itself
 * on an idle beat, on blur, and on the way out of the view. There is no cancel:
 * undo is `⌘Z`, and recovery is the edit session in history (ADR-0008).
 */

const IDLE_MS = 750;

/** What the tile header says about a field that saves itself. */
export type SaveState = 'idle' | 'saving' | 'saved';

/**
 * One save indicator for a tile, however many fields it holds. `saved` is
 * sticky until the next keystroke, so the header answers "did that land?"
 * for as long as the question is live.
 */
export function useSaving() {
  const [state, setState] = useState<SaveState>('idle');
  const depth = useRef(0);
  const run = useCallback(async (write: () => Promise<unknown>) => {
    depth.current += 1;
    setState('saving');
    try {
      await write();
    } finally {
      depth.current -= 1;
      if (depth.current === 0) setState('saved');
    }
  }, []);
  return { state, run };
}

export const Saving = ({ state }: { state: SaveState }) =>
  state === 'idle' ? null : (
    <span className="gf-saving" data-testid="saving" data-state={state}>
      {state === 'saving' ? 'saving…' : 'saved'}
    </span>
  );

/** Focus the editor of the focused tile — `e` is a jump, not a mode (DESIGN.md §8). */
export function focusEditor(): void {
  const editable = document.querySelector<HTMLElement>('.gf-tile.is-focus .gf-md [contenteditable="true"]') ?? document.querySelector<HTMLElement>('.gf-md [contenteditable="true"]');
  editable?.focus();
}

export function MarkdownField({
  shape,
  value,
  label,
  placeholder,
  onSave,
  testId,
}: {
  shape: EditorShape;
  /** What the server holds; `null` and `''` are both "nothing written yet". */
  value: string | null;
  label: string;
  placeholder: string;
  onSave: (markdown: string) => Promise<unknown>;
  testId?: string;
}) {
  const server = value ?? '';
  /** The markdown last agreed with the server — what a write is compared against. */
  const agreed = useRef(server);
  /** The markdown in the editor right now, kept as a string so unmount can flush without touching a destroyed editor. */
  const live = useRef(server);
  /** A refetch that arrived while the caret was here; applied on blur, never under the caret. */
  const held = useRef<string | null>(null);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focused = useRef(false);
  const save = useRef(onSave);
  save.current = onSave;
  const [empty, setEmpty] = useState(server.trim() === '');

  const write = useCallback(() => {
    if (idle.current) clearTimeout(idle.current);
    idle.current = null;
    const markdown = live.current;
    if (markdown === agreed.current) return;
    agreed.current = markdown;
    void save.current(markdown);
  }, []);

  const editor = useEditor(
    {
      extensions: extensionsFor(shape),
      content: toDoc(shape, server),
      editorProps: {
        attributes: { 'aria-label': label, role: 'textbox', 'aria-multiline': String(shape === 'block') },
        /**
         * The planner writes a design and you paste it, so plain text is
         * always markdown here — never the literal characters of it. A paste
         * carrying HTML came from a rich source (this editor included) and
         * keeps ProseMirror's own handling.
         */
        handlePaste(_view, event) {
          const data = event.clipboardData;
          const text = data?.getData('text/plain');
          if (!text || data?.getData('text/html')) return false;
          event.preventDefault();
          editorRef.current?.commands.insertContent(toDoc(shape, text).content ?? []);
          return true;
        },
        handleKeyDown(view, event) {
          // `⌘⏎` flushes and lets go; `esc` just lets go — both save, because there is nothing else to do
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            (view.dom as HTMLElement).blur();
            return true;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            (view.dom as HTMLElement).blur();
            return true;
          }
          return false;
        },
      },
      onUpdate({ editor }) {
        live.current = toMarkdown(shape, editor.getJSON());
        setEmpty(editor.isEmpty);
        if (idle.current) clearTimeout(idle.current);
        idle.current = setTimeout(write, IDLE_MS);
      },
      onFocus() {
        focused.current = true;
      },
      onBlur() {
        focused.current = false;
        const mine = live.current !== agreed.current;
        write();
        // a refetch held while you typed is applied now — unless you typed, in which case you were the last writer
        if (held.current !== null) {
          if (!mine) apply(held.current);
          held.current = null;
        }
      },
    },
    [shape],
  );

  /** Replace the document wholesale, without pushing the swap onto the undo stack. */
  const apply = useCallback(
    (markdown: string) => {
      agreed.current = markdown;
      live.current = markdown;
      editorRef.current?.commands.setContent(toDoc(shape, markdown), { emitUpdate: false });
      setEmpty(markdown.trim() === '');
    },
    [shape],
  );
  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;

  // a focused editor owns its field: the poll, a window refocus and an agent's write all wait for the caret to leave
  useEffect(() => {
    if (server === agreed.current) return;
    if (focused.current) held.current = server;
    else apply(server);
  }, [server, apply]);

  // navigating away is the last chance to save; the markdown is a plain string by now, so the editor may already be gone
  useEffect(() => () => write(), [write]);
  useEffect(() => {
    const flush = () => write();
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [write]);

  return (
    <div className={`gf-md is-${shape}${empty ? ' is-empty' : ''}`} data-testid={testId} data-placeholder={placeholder}>
      <EditorContent editor={editor} />
    </div>
  );
}
