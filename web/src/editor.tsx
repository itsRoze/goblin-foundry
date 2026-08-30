import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { extensionsFor, toDoc, toMarkdown, type EditorShape } from './markdown';
import { refusalLine } from './ui';

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
 * sticky until the next write, so the header answers "did that land?" for as
 * long as the question is live — and says nothing at all when the write was
 * refused, because the field itself carries that sentence.
 */
export function useSaving() {
  const [state, setState] = useState<SaveState>('idle');
  const depth = useRef(0);
  const run = useCallback(async (write: () => Promise<unknown>) => {
    depth.current += 1;
    setState('saving');
    try {
      await write();
      depth.current -= 1;
      if (depth.current === 0) setState('saved');
    } catch (e) {
      depth.current -= 1;
      if (depth.current === 0) setState('idle');
      throw e;
    }
  }, []);
  return { state, run };
}

/** What `useSaving` hands back: the tile's indicator, and the wrapper every field's write goes through. */
export type Saver = ReturnType<typeof useSaving>;

export const Saving = ({ state }: { state: SaveState }) =>
  state === 'idle' ? null : (
    <span className="gf-saving" data-testid="saving" data-state={state}>
      {state === 'saving' ? 'saving…' : 'saved'}
    </span>
  );

/**
 * Put the caret in the focused tile's editor, or in the first one on the page
 * when that tile has none — `e` is a jump, not a mode (DESIGN.md §8). Tile
 * focus is static until `⌘1–6` arrives (issue 10), so in practice this reaches
 * the first field of the view; the others are a click away.
 */
export function focusEditor(): void {
  const inFocusedTile = document.querySelector<HTMLElement>('.gf-tile.is-focus .gf-md [contenteditable="true"]');
  (inFocusedTile ?? document.querySelector<HTMLElement>('.gf-md [contenteditable="true"]'))?.focus();
}

/** ProseMirror stamps its own clipboard HTML with this; anything else claiming to be HTML came from elsewhere. */
const OWN_SLICE = 'data-pm-slice';

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
  /** Resolves when the write landed and rejects when it was refused — the field will not call it agreed until it resolves. */
  onSave: (markdown: string) => Promise<unknown>;
  testId?: string;
}) {
  const server = value ?? '';
  /** The markdown the server is known to hold — what a write is compared against. Advances only when a write lands. */
  const agreed = useRef(server);
  /** The markdown in the editor right now, kept as a string so unmount can flush without touching a destroyed editor. */
  const live = useRef(server);
  /** The markdown a write is currently carrying, so an idle beat and a blur do not send the same body twice. */
  const sending = useRef<string | null>(null);
  /** A refetch that arrived while the caret was here; applied on blur, never under the caret. */
  const held = useRef<string | null>(null);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focused = useRef(false);
  const save = useRef(onSave);
  const editorRef = useRef<Editor | null>(null);
  const [empty, setEmpty] = useState(server.trim() === '');
  const [refusal, setRefusal] = useState<string | null>(null);

  const write = useCallback(() => {
    if (idle.current) clearTimeout(idle.current);
    idle.current = null;
    const markdown = live.current;
    if (markdown === agreed.current || markdown === sending.current) return;
    sending.current = markdown;
    void save.current(markdown).then(
      () => {
        // only now is this what the server holds; until it is, the next beat or the blur retries
        agreed.current = markdown;
        sending.current = null;
        setRefusal(null);
      },
      (error: unknown) => {
        sending.current = null;
        setRefusal(refusalLine(error));
      },
    );
  }, []);

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

  const editor = useEditor(
    {
      extensions: extensionsFor(shape),
      content: toDoc(shape, server),
      editorProps: {
        attributes: { 'aria-label': label, role: 'textbox', 'aria-multiline': String(shape === 'block') },
        /**
         * The planner writes a design and you paste it, so plain text is
         * always markdown here — never the literal characters of it. Editors
         * put a highlighted `text/html` flavour on the clipboard beside the
         * text, so only this editor's own slice defers to ProseMirror.
         */
        handlePaste(_view, event) {
          const data = event.clipboardData;
          const text = data?.getData('text/plain');
          if (!text || data?.getData('text/html').includes(OWN_SLICE)) return false;
          event.preventDefault();
          editorRef.current?.commands.insertContent(toDoc(shape, text).content ?? []);
          return true;
        },
        // `⌘⏎` flushes and lets go; `esc` just lets go — both save, because there is nothing else to do
        handleKeyDown(view, event) {
          if ((event.key === 'Enter' && (event.metaKey || event.ctrlKey)) || event.key === 'Escape') {
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
        // a refetch held while you typed is applied now — unless you typed, in which case you were the last writer and it is dropped
        if (held.current !== null) {
          if (!mine) apply(held.current);
          held.current = null;
        }
      },
    },
    [shape],
  );
  // written in an effect, not in the render body: a discarded render must not reach the live editor
  useLayoutEffect(() => {
    editorRef.current = editor;
    save.current = onSave;
  });

  // a focused editor owns its field: the poll, a window refocus and an agent's write all wait for the caret to leave
  useEffect(() => {
    if (server === agreed.current) {
      // the field caught up on its own — a refetch held from before it did would put the old body back
      held.current = null;
      return;
    }
    if (focused.current) held.current = server;
    else apply(server);
  }, [server, apply]);

  // navigating away is the last chance to save; the markdown is a plain string by now, so the editor may already be gone
  useEffect(() => () => write(), [write]);
  useEffect(() => {
    // a tab going away is best-effort — the request has to outlive the page for it to land
    const flush = () => {
      if (document.visibilityState === 'hidden') write();
    };
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('pagehide', write);
    return () => {
      document.removeEventListener('visibilitychange', flush);
      window.removeEventListener('pagehide', write);
    };
  }, [write]);

  return (
    <div className={`gf-md is-${shape}${empty ? ' is-empty' : ''}`} data-testid={testId} data-placeholder={placeholder}>
      <EditorContent editor={editor} />
      {refusal && (
        <p className="gf-refusal" role="alert">
          {refusal}
        </p>
      )}
    </div>
  );
}
