import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import { INLINE_MARKS, extensionsFor, toDoc, toMarkdown, toggleWholeMark, type EditorShape } from './markdown';
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

/** Where the code block around the caret starts, or `null` when the caret is not in one. */
function fenceNodePos(editor: Editor): number | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) if ($from.node(depth).type.name === 'codeBlock') return $from.before(depth);
  return null;
}

/** One button on the mode line: what it says, what it does, and when it is lit. */
interface Control {
  /** The schema name it acts on, which is also how the mode line asks whether this editor has it. */
  id: string;
  label: ReactNode;
  /** What it is, in one word or two (DESIGN.md §9), and the key that does the same thing — `undefined` when it has none. */
  name: string;
  key?: string;
  active: (e: Editor) => boolean;
  run: (e: Editor) => void;
}

const title = (c: Control) => (c.key ? `${c.name} · ${c.key}` : c.name);

/** Words, not glyphs: kinds and states are single words in this GUI (DESIGN.md §9). */
/** Keyed by the table's own names, so a mark added there is a type error here until it is given a face. */
type MarkName = (typeof INLINE_MARKS)[number]['name'];
const MARK_LABEL: Record<MarkName, ReactNode> = { bold: <b>b</b>, italic: <i>i</i>, code: 'code', strike: <s>s</s> };
const MARK_NAME: Record<MarkName, string> = { bold: 'bold', italic: 'italic', code: 'code', strike: 'strikethrough' };

const MARKS: Control[] = INLINE_MARKS.map(({ name, key }) => ({
  id: name,
  label: MARK_LABEL[name],
  name: MARK_NAME[name],
  key,
  active: (e: Editor) => e.isActive(name),
  run: (e: Editor) => toggleWholeMark(e, name),
}));

const BLOCKS: Control[] = [
  { id: 'bulletList', label: 'list', name: 'bullet list', key: '⌘⇧8', active: (e) => e.isActive('bulletList'), run: (e) => e.chain().focus().toggleBulletList().run() },
  { id: 'orderedList', label: '1.', name: 'numbered list', key: '⌘⇧7', active: (e) => e.isActive('orderedList'), run: (e) => e.chain().focus().toggleOrderedList().run() },
  // no key: the list extensions bind `⌘⇧7` and `⌘⇧8` and stop there
  { id: 'taskList', label: 'task', name: 'task list', active: (e) => e.isActive('taskList'), run: (e) => e.chain().focus().toggleTaskList().run() },
  { id: 'blockquote', label: 'quote', name: 'quote', key: '⌘⇧B', active: (e) => e.isActive('blockquote'), run: (e) => e.chain().focus().toggleBlockquote().run() },
  // `fence` is markdown's own word for ```, which the document no longer shows you — the right slot edits its language
  { id: 'codeBlock', label: 'fence', name: 'code fence', key: '⌘⌥C', active: (e) => e.isActive('codeBlock'), run: (e) => e.chain().focus().toggleCodeBlock().run() },
];

const HEADINGS: Control[] = ([1, 2, 3, 4, 5, 6] as const).map((level) => ({
  id: `h${level}`,
  label: `h${level}`,
  name: `heading ${level}`,
  key: `⌘⌥${level}`,
  active: (e: Editor) => e.isActive('heading', { level }),
  run: (e: Editor) => e.chain().focus().toggleHeading({ level }).run(),
}));

export function MarkdownField({
  shape,
  value,
  label,
  placeholder,
  onSave,
  fill,
  testId,
}: {
  shape: EditorShape;
  /** What the server holds; `null` and `''` are both "nothing written yet". */
  value: string | null;
  label: string;
  placeholder: string;
  /** Resolves when the write landed and rejects when it was refused — the field will not call it agreed until it resolves. */
  onSave: (markdown: string) => Promise<unknown>;
  /** This field is what its tile is for, so it takes the whole of it: the mode line sits on the tile's bottom edge and the click target is the tile. */
  fill?: boolean;
  testId?: string;
}) {
  const server = value ?? '';
  /** The markdown the server is known to hold — what a write is compared against. Advances only when a write lands. */
  const agreed = useRef(server);
  /** The markdown in the editor right now, kept as a string so unmount can flush without touching a destroyed editor. */
  const live = useRef(server);
  /** The markdown a write is currently carrying, so an idle beat and a blur do not send the same body twice. */
  const sending = useRef<string | null>(null);
  /** Which write is the latest, so an earlier one resolving late cannot report an older body as what the server holds. */
  const issued = useRef(0);
  /** Whether anything has been typed since the field was taken up. A held refetch loses to that, whether or not the write has landed yet. */
  const touched = useRef(false);
  /** A refetch that arrived while the caret was here; applied on blur, never under the caret. */
  const held = useRef<string | null>(null);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Mirrors `engaged` for the callbacks that cannot see React state. */
  const engagedRef = useRef(false);
  const save = useRef(onSave);
  const editorRef = useRef<Editor | null>(null);
  const [empty, setEmpty] = useState(server.trim() === '');
  const [refusal, setRefusal] = useState<string | null>(null);
  /**
   * Focus is somewhere in this field — the document, or one of the mode line's
   * own inputs. Tracked on the container rather than the editor, because
   * typing a URL takes the caret out of the document and the line has to
   * outlive that.
   */
  const [engaged, setEngaged] = useState(false);
  /** The URL being typed, or `null` when the link slot is closed. Keeps the mode line up while it has the focus. */
  const [linking, setLinking] = useState<string | null>(null);
  /** What was selected when the link slot opened. Moving the caret into an input collapses ProseMirror's selection, so the range has to be carried by hand. */
  const linkRange = useRef<{ from: number; to: number } | null>(null);

  const write = useCallback(() => {
    if (idle.current) clearTimeout(idle.current);
    idle.current = null;
    const markdown = live.current;
    if (markdown === agreed.current || markdown === sending.current) return;
    sending.current = markdown;
    const write = (issued.current += 1);
    void save.current(markdown).then(
      () => {
        // an earlier write resolving after a later one would name a body the server has already moved past
        if (write !== issued.current) return;
        // only now is this what the server holds; until it is, the next beat or the blur retries
        agreed.current = markdown;
        sending.current = null;
        setRefusal(null);
      },
      (error: unknown) => {
        if (write !== issued.current) return;
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
      touched.current = false;
      editorRef.current?.commands.setContent(toDoc(shape, markdown), { emitUpdate: false });
      setEmpty(markdown.trim() === '');
    },
    [shape],
  );

  /** `⌘K`: the mode line's right slot becomes the URL field, seeded with the link already on the selection. */
  const openLink = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const { from, to } = editor.state.selection;
    linkRange.current = { from, to };
    setLinking((editor.getAttributes('link').href as string | undefined) ?? '');
  }, []);

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
        handleKeyDown(view, event) {
          // `⌘K` is the one mark with no key of its own, because it needs somewhere to type the URL
          if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            openLink();
            return true;
          }
          // `⌘⏎` flushes and lets go; `esc` just lets go — both save, because there is nothing else to do
          if ((event.key === 'Enter' && (event.metaKey || event.ctrlKey)) || event.key === 'Escape') {
            event.preventDefault();
            (view.dom as HTMLElement).blur();
            return true;
          }
          return false;
        },
      },
      onUpdate({ editor }) {
        touched.current = true;
        live.current = toMarkdown(shape, editor.getJSON());
        setEmpty(editor.isEmpty);
        if (idle.current) clearTimeout(idle.current);
        idle.current = setTimeout(write, IDLE_MS);
      },
    },
    [shape],
  );

  /**
   * Letting go of the field — not merely of the document, since the caret
   * moves into the mode line's own inputs and comes back. Flushing on that
   * would replace the document under the very control you are using.
   */
  const release = useCallback(() => {
    engagedRef.current = false;
    setEngaged(false);
    const mine = touched.current;
    write();
    // a refetch held while you had the field is applied now — unless you typed, in which case you were the last writer and it is dropped
    if (held.current !== null) {
      if (!mine) apply(held.current);
      held.current = null;
    }
    touched.current = false;
  }, [write, apply]);
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
    if (engagedRef.current) held.current = server;
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
    <div
      className={`gf-md is-${shape}${empty ? ' is-empty' : ''}${fill ? ' is-fill' : ''}`}
      data-testid={testId}
      data-placeholder={placeholder}
      onFocus={() => {
        engagedRef.current = true;
        setEngaged(true);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) release();
      }}
    >
      <EditorContent editor={editor} className="gf-md-content" />
      {editor && engaged && (
        <ModeLine editor={editor} shape={shape} linking={linking} setLinking={setLinking} openLink={openLink} range={linkRange} />
      )}
      {refusal && (
        <p className="gf-refusal" role="alert">
          {refusal}
        </p>
      )}
    </div>
  );
}

/**
 * The mode line: a status bar docked to the bottom of the field while the
 * caret is in it, in the tiling-WM vernacular the rest of the GUI speaks
 * (DESIGN.md §1). Every control names its key, so clicking teaches the
 * keyboard rather than replacing it. Its right slot is contextual — the URL
 * field on `⌘K`, the language of the code block you are standing in, and
 * otherwise the key that puts the field down.
 */
function ModeLine({
  editor,
  shape,
  linking,
  setLinking,
  openLink,
  range,
}: {
  editor: Editor;
  shape: EditorShape;
  linking: string | null;
  setLinking: (href: string | null) => void;
  openLink: () => void;
  range: { current: { from: number; to: number } | null };
}) {
  // only what this configuration's schema actually has: the inline shape has no strike, so it gets no strike button
  const marks = useMemo(() => MARKS.filter((c) => c.id in editor.schema.marks), [editor]);
  const groups = useMemo(() => (shape === 'block' ? [HEADINGS, marks, BLOCKS] : [marks]), [shape, marks]);
  const linkGroup = shape === 'block' ? 1 : 0;
  const state = useEditorState({
    editor,
    // every field here is a primitive: the selector runs on each transaction, and an object would re-render the line per keystroke
    selector: ({ editor }) => ({
      on: groups
        .flat()
        .filter((c) => c.active(editor))
        .map((c) => c.id)
        .join(' '),
      linked: editor.isActive('link'),
      // the code block's own position, not the caret's: the language is set on the node, from a field the caret has moved into
      fencePos: fenceNodePos(editor),
      fenceLang: (editor.getAttributes('codeBlock').language as string | null) ?? '',
    }),
  });
  const isOn = (id: string) => state.on.split(' ').includes(id);

  /**
   * The fence the caret is in. Held in state rather than read live, because
   * typing in the language field takes the caret out of the document — and a
   * slot that vanishes the moment you use it is no slot at all.
   */
  const [fence, setFence] = useState<{ pos: number; language: string } | null>(null);
  const typingLang = useRef(false);
  useEffect(() => {
    if (typingLang.current) return;
    setFence(state.fencePos === null ? null : { pos: state.fencePos, language: state.fenceLang ?? '' });
  }, [state.fencePos, state.fenceLang]);

  /** Put the selection back where it was before the caret moved into the field, then act on it. */
  const restore = () => {
    const at = range.current;
    const chain = editor.chain().focus();
    return at ? chain.setTextSelection(at) : chain;
  };

  /**
   * Closing the link slot, once. `restore()` puts the caret back in the
   * document, which blurs this input — so `onBlur` re-enters here while the
   * first call is still running, and `esc` would land the link it was cancelling.
   */
  const closing = useRef(false);
  const close = (act?: () => void) => {
    if (closing.current) return;
    closing.current = true;
    try {
      act?.();
    } finally {
      range.current = null;
      setLinking(null);
      closing.current = false;
    }
  };

  const commit = () =>
    close(() => {
      const href = (linking ?? '').trim();
      const at = range.current;
      if (href === '') restore().extendMarkRange('link').unsetLink().run();
      else if (at && at.from === at.to && !editor.isActive('link'))
        // no selection to wrap: the URL becomes its own link text, which is what you meant by asking for a link here
        restore().insertContent([{ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }]).run();
      else restore().extendMarkRange('link').setLink({ href }).run();
    });

  return (
    // mousedown inside the line must not take the caret out of the field, or the command would have nothing to act on
    <div className="gf-mode" onMouseDown={(e) => e.preventDefault()} data-testid="mode-line">
      {groups.map((group, i) => (
        <div className="gf-mode-group" key={i}>
          {group.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`gf-mode-btn${isOn(c.id) ? ' is-on' : ''}`}
              title={title(c)}
              aria-label={c.name}
              aria-pressed={isOn(c.id)}
              data-testid={`fmt-${c.id}`}
              onClick={() => c.run(editor)}
            >
              {c.label}
            </button>
          ))}
          {i === linkGroup && (
            <button
              type="button"
              className={`gf-mode-btn${state.linked ? ' is-on' : ''}`}
              title="link · ⌘K"
              aria-label="link"
              aria-pressed={state.linked}
              data-testid="fmt-link"
              onClick={openLink}
            >
              link
            </button>
          )}
        </div>
      ))}

      <div className="gf-mode-slot">
        {linking !== null ? (
          <input
            autoFocus
            type="text"
            className="gf-mode-input"
            aria-label="link url"
            placeholder="https://"
            value={linking}
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => setLinking(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                // `esc` is the one cancel left in the editor: it puts the caret back and writes nothing
                close(() => restore().run());
              }
            }}
          />
        ) : fence !== null ? (
          // the fence's language, which the document itself no longer shows you
          <input
            type="text"
            className="gf-mode-input is-lang"
            aria-label="code language"
            placeholder="plain"
            value={fence.language}
            onMouseDown={(e) => e.stopPropagation()}
            onFocus={() => (typingLang.current = true)}
            onBlur={() => (typingLang.current = false)}
            onChange={(e) => {
              const language = e.target.value;
              setFence({ ...fence, language });
              // the caret is in this input, so the block is rewritten where it stands rather than where the selection is
              editor.commands.command(({ tr, dispatch }) => {
                const node = tr.doc.nodeAt(fence.pos);
                if (!node) return false;
                if (dispatch) tr.setNodeMarkup(fence.pos, undefined, { ...node.attrs, language });
                return true;
              });
            }}
          />
        ) : (
          <span className="gf-mode-hint">
            <kbd className="gf-kbd">⌘⏎</kbd> done
          </span>
        )}
      </div>
    </div>
  );
}
