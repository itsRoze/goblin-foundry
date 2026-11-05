import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import type { JSONContent, TiptapEditorHTMLElement } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { INLINE_MARKS, canonical, extensionsFor, toDoc, toMarkdown, toggleWholeMark, type EditorShape } from './markdown';
import { chooseToPaste } from './paste';
import { judgement } from '@goblin/shared';
import { unreached } from './api';
import { ForPointer, refusalLine } from './ui';

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
 * One save indicator for a tile, however many fields it holds. `saved` stays
 * until the tile's editor holds words that have not landed, so the header answers
 * "did that land?" for as long as the question is live — and says nothing at all
 * when the write was refused, because the field itself carries that sentence.
 */
export function useSaving() {
  const [said, setSaid] = useState<SaveState>('idle');
  const [fieldState, setFieldState] = useState<SaveState | null>(null);
  const depth = useRef(0);
  const run = useCallback(async <T,>(write: () => Promise<T>): Promise<T> => {
    depth.current += 1;
    setSaid('saving');
    try {
      const result = await write();
      depth.current -= 1;
      if (depth.current === 0) setSaid('saved');
      return result;
    } catch (e) {
      depth.current -= 1;
      if (depth.current === 0) setSaid('idle');
      throw e;
    }
  }, []);
  const writeIsOut = said === 'saving';
  const fieldHasNoWordOfItsOwn = fieldState === null || fieldState === 'saved';
  const state: SaveState = writeIsOut || fieldHasNoWordOfItsOwn ? said : fieldState;
  return { state, run, setFieldState };
}

/** What `useSaving` hands back: the tile's indicator, the wrapper every field's write goes through, and where its editor reports its own state. */
export type Saver = ReturnType<typeof useSaving>;

export const Saving = ({ state, testId = 'saving' }: { state: SaveState; testId?: string }) =>
  state === 'idle' ? null : (
    <span className="gf-saving" data-testid={testId} data-state={state}>
      {state === 'saving' ? 'saving…' : 'saved'}
    </span>
  );

/**
 * Put the caret in the focused tile's editor, or in the first one on the page
 * when that tile has none — `e` is a jump, not a mode (DESIGN.md Interaction).
 * Which tile that is now moves: `⌘1–6` and a click both set it (issue 10), so
 * `⌘2 e` reaches the second editor on a view without touching the mouse.
 */
export function focusEditor(): void {
  const inFocusedTile = document.querySelector<TiptapEditorHTMLElement>('.gf-tile.is-focus .gf-md [contenteditable="true"]');
  const editor = (inFocusedTile ?? document.querySelector<TiptapEditorHTMLElement>('.gf-md [contenteditable="true"]'))?.editor;
  if (!editor) return;
  // through the editor, not its element: the editor's focus writes its caret to the browser in the same
  // instant, where the element's leaves the browser's caret at the document start until the first flush,
  // and a key pressed in that window acts there (GF-96)
  editor.view.focus();
  // the focus is dealt with, which prosemirror-view says with this field: its flush otherwise takes a caret that
  // reaches the document start inside 200 ms (Home, ⌘↑) for the browser's reset on focus and puts the editor's back
  internals(editor.view).input.lastFocus = 0;
  // the editor's focus keeps the browser from scrolling to the field
  editor.commands.scrollIntoView();
}

/**
 * The two fields of prosemirror-view 1.42 that its typings leave out and this file writes, both to keep its
 * focus handling from putting the editor's caret over the browser's after a caret key (GF-96). A release that
 * renames either brings the lost keys back silently; the frozen-page specs in `e2e/writing.e2e.ts` would show it.
 */
const internals = (view: Editor['view']) => view as unknown as { focused: boolean; input: { lastFocus: number } };

/** ProseMirror stamps its own clipboard HTML with this; anything else claiming to be HTML came from elsewhere. */
const OWN_SLICE = 'data-pm-slice';

/**
 * Text that is nothing but a URL. Pasted over a selection it means "make this a
 * link", which the link extension already does — so this field's own paste
 * handling has to get out of the way rather than swallow it as markdown.
 */
function isBareUrl(text: string): boolean {
  const value = text.trim();
  if (value === '' || /\s/.test(value)) return false;
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`).hostname.includes('.');
  } catch {
    return false;
  }
}

/** The document an insert at the selection would make, with nothing dispatched, or `null` if the schema refuses it. `preventDispatch` is how TipTap's command manager is told to keep the transaction to itself. */
function docAfterInsert(editor: Editor, content: JSONContent[]): JSONContent | null {
  let doc: JSONContent | null = null;
  try {
    editor
      .chain()
      .setMeta('preventDispatch', true)
      .insertContent(content)
      .command(({ tr }) => {
        doc = tr.doc.toJSON() as JSONContent;
        return true;
      })
      .run();
  } catch {
    return null;
  }
  return doc;
}

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
  /** What it is, in one word or two (DESIGN.md Voice), and the key that does the same thing — `undefined` when it has none. */
  name: string;
  key?: string;
  active: (e: Editor) => boolean;
  run: (e: Editor) => void;
}

const title = (c: Control) => (c.key ? `${c.name} · ${c.key}` : c.name);

/** Words, not glyphs: kinds and states are single words in this GUI (DESIGN.md Voice). */
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

/**
 * A field's bodies, kept by field and not by mount. The view that holds a
 * field is keyed on its entity (GF-76), so it is gone before a write sent on
 * the way out answers, and before a refused one can say so. The record is what
 * the next mount of the same field starts from, so words the server has not
 * taken are never lost with the view (GF-79, GF-83).
 */
interface FieldRecord {
  /** The column this field is, which a write names as what it judged. */
  field: string;
  /** The markdown the server is known to hold — what a write is compared against and judged on. Advances only when a write lands or a read is taken. */
  agreed: Version;
  /** The markdown in the editor, kept as a string so a flush never touches a destroyed editor. */
  live: string;
  /** The markdown the one write out is carrying: whole bodies land in arrival order, so a second is not sent until it answers. */
  sending: string | null;
  /** Bodies sent and never answered, which may still land: read back, one is this record's own words and not a move. Cleared once a later write lands, which refuses them unless the field has since been put back to the very words they were judged on. */
  unanswered: string[];
  /** The sentence the last write was refused with, until one lands. */
  refusal: string | null;
  /** A read that arrived while the caret was in the field; applied on release, never under the caret, and nothing is sent past it. */
  held: Version | null;
  /** The server's body, read while the field held words it lacks: nothing is sent until the person keeps their words or takes this. */
  moved: Version | null;
  /** How the latest mount writes: the hook that patches belongs to the view. */
  save: (markdown: string, judged: string) => Promise<unknown>;
  /** The mount showing this field, told when its sentence changes. */
  listeners: Set<() => void>;
}

/** A body as the server gave it, with what a write of it names as judged (`judgement` in `@goblin/shared`), so one given up on cannot land late over a later one. */
interface Version {
  body: string;
  judged: string;
}

/** `ticket/3/design`: the entity and the column, which together name a record. */
export type FieldId = `${'ticket' | 'project' | 'app'}/${number}/${'description' | 'design'}`;

const columnOf = (id: FieldId) => id.slice(id.lastIndexOf('/') + 1);

/** A finger has no `esc`, so taking theirs is not offered (DESIGN.md Touch targets). */
const MOVED = <ForPointer fine="changed elsewhere while unsaved; in the field, ⌘⏎ saves yours, esc takes theirs" coarse="changed elsewhere while unsaved; in the field, done saves yours" />;

const records = new Map<FieldId, FieldRecord>();

/** The field holds words the server does not. */
const unsaved = (record: FieldRecord) => record.live !== record.agreed.body;

/** Nothing unsaved, nothing out and nothing that may still land: the record says only what the server said last time, and a mount may start afresh. */
const settled = (record: FieldRecord) => record.sending === null && record.unanswered.length === 0 && !unsaved(record);

const heldBack = (record: FieldRecord) => record.held !== null || record.moved !== null;

const landed = (record: FieldRecord) => settled(record) && !heldBack(record);

function saveStateOf(record: FieldRecord): SaveState {
  if (landed(record)) return 'saved';
  const onItsWay = record.sending !== null || unsaved(record);
  const nextBeatSendsNothing = heldBack(record) || record.refusal !== null;
  return onItsWay && !nextBeatSendsNothing ? 'saving' : 'idle';
}

/** The parser does not read back everything the serialiser writes (`1. a\n\n b`), so a read's body can differ from the words the server was sent (GF-104). */
function ownBody(record: FieldRecord, read: Version): string | null {
  if (read.judged === record.agreed.judged) return record.agreed.body;
  const bodies = [record.agreed.body, record.live, record.sending, ...record.unanswered].filter((body) => body !== null);
  return bodies.find((body) => judgement(record.field, body) === read.judged) ?? bodies.find((body) => body === read.body) ?? null;
}

/** The read held under the caret, let go: handed back to apply when nothing is unsaved, otherwise it is the body that moved. */
function unhold(record: FieldRecord): Version | null {
  const held = record.held;
  if (held === null) return null;
  record.held = null;
  if (!unsaved(record)) return held;
  record.moved = held;
  notify(record);
  return null;
}

/** A read held under unsaved words stops every write, so it is told as the body that moved. */
const sentenceOf = (record: FieldRecord) => (record.moved !== null || (record.held !== null && unsaved(record)) ? MOVED : record.refusal);

function recordFor(id: FieldId, fetched: Version, save: FieldRecord['save']): FieldRecord {
  const kept = records.get(id);
  if (kept && !settled(kept)) return kept;
  return { field: columnOf(id), agreed: fetched, live: fetched.body, sending: null, unanswered: [], refusal: null, held: null, moved: null, save, listeners: new Set() };
}

const HISTORY = 'history$';

/** Typing is an answer to a body that moved; an undo is not, since undone far enough it takes the server's words. prosemirror-history stamps its own transactions with its plugin key. */
const isUndo = (transaction: { getMeta(key: string): unknown }) => transaction.getMeta(HISTORY) !== undefined;

/**
 * Why the whole document is being replaced, which decides what `⌘Z` may take back afterwards (GF-105).
 * - `outside`: words from elsewhere. Nothing on the stacks is about them, and any press would write the person's older words over them, so the stacks are emptied.
 * - `asked`: `esc` dropped words the server never held. Its own step, because `⌘Z` is the way back to them.
 * - `readBack`: the person's own words as a reload reads them. Part of the edit before it, so one press takes both back: as a step of its own a press would change nothing the person can see and send what the server holds, and off the stack every step before it would be gone.
 */
type Swap = 'outside' | 'asked' | 'readBack';

/** prosemirror-history has no command for this, but a transaction carrying its key hands it the state it is to have, which is how its own undo works. */
function emptyHistory({ view }: Editor) {
  const history = view.state.plugins.find((plugin) => (plugin as unknown as { key: string }).key === HISTORY);
  if (history) view.dispatch(view.state.tr.setMeta(history, { historyState: history.spec.state?.init({}, view.state) }));
}

function swapIn(editor: Editor, content: JSONContent, swap: Swap) {
  const chain = editor.chain();
  if (swap === 'outside') chain.setMeta('addToHistory', false);
  if (swap === 'asked') chain.command(({ tr }) => !!closeHistory(tr));
  // what prosemirror-history reads as "part of the event before this"
  if (swap === 'readBack') chain.setMeta('appendedTransaction', editor.state.tr);
  chain.setContent(content, { emitUpdate: false }).run();
  if (swap === 'outside') emptyHistory(editor);
  if (swap === 'readBack') editor.view.dispatch(closeHistory(editor.state.tr));
}

function keep(record: FieldRecord) {
  if (record.moved === null) return;
  record.agreed = record.moved;
  record.moved = null;
  record.refusal = null;
  notify(record);
}

/** `⌘⏎` and `done` answer the sentence with the caret still in the field, where a keystroke does not: it would write over a body nobody has read. */
const keepYours = (record: FieldRecord) => {
  if (unsaved(record)) unhold(record);
  keep(record);
};

/** A mount's subscription to its record, which is also what keeps the record on the map while the mount lasts. */
function watch(id: FieldId, record: FieldRecord, tell: () => void) {
  records.set(id, record);
  record.listeners.add(tell);
  return () => {
    record.listeners.delete(tell);
  };
}

const notify = (record: FieldRecord) => {
  for (const tell of record.listeners) tell();
};

function flush(record: FieldRecord) {
  if (record.sending !== null || record.moved !== null || record.held !== null) return;
  const markdown = record.live;
  if (markdown === record.agreed.body) {
    // undone back to what the server holds: there is nothing left to refuse
    if (record.refusal !== null) {
      record.refusal = null;
      notify(record);
    }
    return;
  }
  record.sending = markdown;
  const judgedOn = record.agreed.judged;
  void record.save(markdown, judgedOn).then(
    () => {
      // only now is this what the server holds; what was typed meanwhile goes out next
      record.agreed = { body: markdown, judged: judgement(record.field, markdown) };
      record.sending = null;
      record.unanswered = [];
      record.refusal = null;
      notify(record);
      flush(record);
    },
    (error: unknown) => {
      // not sent again on its own: the next beat, the blur or the way out retries
      record.sending = null;
      if (unreached(error)) record.unanswered.push(markdown);
      const judgementAdvancedByOwnLanding = record.agreed.judged !== judgedOn;
      if (judgementAdvancedByOwnLanding) return flush(record);
      record.refusal = refusalLine(error);
      notify(record);
    },
  );
}

export function MarkdownField({
  id,
  shape,
  value,
  label,
  placeholder,
  onSave,
  onSaveState,
  fill,
  status,
  testId,
}: {
  /** Which field this is across mounts: what was typed into it outlives the view that holds it. */
  id: FieldId;
  shape: EditorShape;
  /** What the server holds; `null` and `''` are both "nothing written yet". */
  value: string | null;
  label: string;
  placeholder: ReactNode;
  /** Resolves when the write landed and rejects when it was refused — the field will not call it agreed until it resolves. `judged` is the header value naming what it was judged on. */
  onSave: (markdown: string, judged: string) => Promise<unknown>;
  /** Told the state of the field's words, so the tile says `saved` only of words that have landed. `null` once the field has gone, as `edit` swaps it for a form, and can no longer hear its write land: the tile goes by its writes alone. */
  onSaveState: (state: SaveState | null) => void;
  /** This field is what its tile is for, so it takes the whole of it: the mode line sits on the tile's bottom edge and the click target is the tile. */
  fill?: boolean;
  /** The tile's save word, echoed in the mode line where a phone with its keyboard up can still see it (issue 11). */
  status?: SaveState;
  testId?: string;
}) {
  const server = value ?? '';
  const fetched = useMemo<Version>(() => ({ body: canonical(shape, server), judged: judgement(columnOf(id), server) }), [shape, server, id]);
  const [record] = useState(() => recordFor(id, fetched, onSave));
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Mirrors `engaged` for the callbacks that cannot see React state. */
  const engagedRef = useRef(false);
  const editorRef = useRef<Editor | null>(null);
  const [empty, setEmpty] = useState(record.live.trim() === '');
  const subscribe = useCallback((tell: () => void) => watch(id, record, tell), [id, record]);
  const refusal = useSyncExternalStore(subscribe, () => sentenceOf(record));
  const saveState = useSyncExternalStore(subscribe, () => saveStateOf(record));
  useEffect(() => onSaveState(saveState), [onSaveState, saveState]);
  useEffect(
    () => () => {
      if (!heldBack(record)) onSaveState(null);
    },
    [onSaveState, record],
  );
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
    flush(record);
  }, [record]);

  const apply = useCallback(
    (read: Version, swap: Swap = 'outside') => {
      record.agreed = read;
      record.live = read.body;
      const editor = editorRef.current;
      const alreadyHeld = swap === 'readBack' && editor !== null && toMarkdown(shape, editor.getJSON()) === read.body;
      if (editor && !alreadyHeld) swapIn(editor, toDoc(shape, read.body), swap);
      setEmpty(read.body.trim() === '');
      notify(record);
    },
    [shape, record],
  );

  const lastChangeWasUndo = useRef(false);

  /** With the caret gone and nothing unsaved the field shows what a reload would, which is not always what the serialiser wrote. Not after an undo: no event is left to join, and undoing a swap of its own would send what the server holds, then the next click away would swap it in again. */
  const showStored = useCallback(() => {
    if (!engagedRef.current && !lastChangeWasUndo.current && landed(record) && fetched.judged === record.agreed.judged && fetched.body !== record.live) apply(fetched, 'readBack');
  }, [apply, fetched, record]);

  const take = useCallback((swap?: Swap) => {
    if (unsaved(record)) unhold(record);
    if (record.moved === null) return;
    apply(record.moved, swap);
    record.moved = null;
    record.refusal = null;
    notify(record);
  }, [apply, record]);

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
      content: toDoc(shape, record.live),
      editorProps: {
        // our own class on the document, so the house style's selectors are the house's and not ProseMirror's
        attributes: { class: 'gf-doc', 'aria-label': label, role: 'textbox', 'aria-multiline': String(shape === 'block') },
        /**
         * The planner writes a design and you paste it, so plain text is
         * always markdown here — never the literal characters of it. Editors
         * put a highlighted `text/html` flavour on the clipboard beside the
         * text, so only this editor's own slice defers to ProseMirror.
         */
        handlePaste(view, event) {
          const data = event.clipboardData;
          const text = data?.getData('text/plain');
          if (!text || data?.getData('text/html').includes(OWN_SLICE)) return false;
          // a URL dropped on a selection is a link, not a replacement — that is the link extension's job, not ours
          if (!view.state.selection.empty && isBareUrl(text)) return false;
          const editor = editorRef.current;
          const blocks = editor && chooseToPaste(view.state.schema, shape, text, (content) => docAfterInsert(editor, content));
          // no reading keeps every word: ProseMirror's own paste of the plain text is better than none
          if (!editor || !blocks) return false;
          event.preventDefault();
          editor.commands.insertContent(blocks);
          return true;
        },
        handleDOMEvents: {
          /**
           * prosemirror-view's own focus handler arms a 20 ms timer when it finds `focused` false, and
           * the timer writes the editor's caret over the browser's whenever it fires between a caret
           * key's move and the selectionchange that would have read it (GF-96, LESSONS 2026-11-02).
           * With `focused` already true it arms nothing and skips the rest of that branch, which is
           * also where it marks the document focused, so that is done here; the flush's own restore
           * after a focus that reset the caret still runs, and blur still unmarks.
           */
          focus(view) {
            internals(view).focused = true;
            view.dom.classList.add('ProseMirror-focused');
            return false;
          },
        },
        handleKeyDown(view, event) {
          // `⌘K` is the one mark with no key of its own, because it needs somewhere to type the URL
          if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            openLink();
            return true;
          }
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            keepYours(record);
            (view.dom as HTMLElement).blur();
            return true;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            take('asked');
            (view.dom as HTMLElement).blur();
            return true;
          }
          return false;
        },
      },
      onUpdate({ editor, transaction }) {
        const markdown = toMarkdown(shape, editor.getJSON());
        setEmpty(editor.isEmpty);
        // a click changes nothing, but StarterKit's appended paragraph updates, and a bare marker then serialises differently: reading, not an edit (GF-43)
        if (!transaction.docChanged) return;
        lastChangeWasUndo.current = isUndo(transaction);
        if (markdown === record.live) return;
        record.live = markdown;
        notify(record);
        if (!isUndo(transaction)) keep(record);
        if (idle.current) clearTimeout(idle.current);
        idle.current = setTimeout(write, IDLE_MS);
      },
    },
    [shape, record],
  );

  /**
   * Letting go of the field — not merely of the document, since the caret
   * moves into the mode line's own inputs and comes back. Flushing on that
   * would replace the document under the very control you are using.
   */
  const release = useCallback(() => {
    engagedRef.current = false;
    setEngaged(false);
    if (!unsaved(record)) take();
    const read = unhold(record);
    if (read !== null) apply(read);
    showStored();
    write();
  }, [write, apply, showStored, take, record]);
  // written in an effect, not in the render body: a discarded render must not reach the live editor
  useLayoutEffect(() => {
    editorRef.current = editor;
    record.save = onSave;
  });

  // a focused editor owns its field: the poll, a window refocus and an agent's write all wait for the caret to leave
  useEffect(() => {
    const own = ownBody(record, fetched);
    if (own !== null) {
      const landedLate = record.unanswered.includes(own);
      const wasHeldBack = heldBack(record);
      record.agreed = { body: own, judged: fetched.judged };
      record.held = null;
      record.moved = null;
      if (record.refusal !== null && (landedLate || own === record.live)) record.refusal = null;
      notify(record);
      if (landedLate) record.unanswered = [];
      if (landedLate || wasHeldBack) flush(record);
      return;
    }
    if (engagedRef.current) {
      record.held = fetched;
      notify(record);
    } else if (!unsaved(record)) apply(fetched);
    else {
      record.moved = fetched;
      notify(record);
    }
  }, [fetched, apply, record]);
  // a write's answer and its read arrive in either order, and each can be the one that settles the field
  useEffect(showStored, [saveState, showStored]);

  // navigating away is the last chance to save; the markdown is a plain string by now, so the editor may already be gone
  useEffect(
    () => () => {
      write();
      // a record that says nothing the server does not is let go of; one with words out or kept waits for the next mount
      if (settled(record) && records.get(id) === record) records.delete(id);
    },
    [write, record, id],
  );
  useEffect(() => {
    // a tab going away is best-effort — the request has to outlive the page for it to land
    const whenHidden = () => {
      if (document.visibilityState === 'hidden') write();
    };
    document.addEventListener('visibilitychange', whenHidden);
    window.addEventListener('pagehide', write);
    return () => {
      document.removeEventListener('visibilitychange', whenHidden);
      window.removeEventListener('pagehide', write);
    };
  }, [write]);

  return (
    <div
      className={`gf-md is-${shape}${empty ? ' is-empty' : ''}${fill ? ' is-fill' : ''}${engaged ? ' is-engaged' : ''}`}
      data-testid={testId}
      onFocus={() => {
        engagedRef.current = true;
        setEngaged(true);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) release();
      }}
    >
      {empty && <p className="gf-md-placeholder">{placeholder}</p>}
      <EditorContent editor={editor} className="gf-md-content" />
      {editor && engaged && (
        <ModeLine editor={editor} shape={shape} linking={linking} setLinking={setLinking} openLink={openLink} range={linkRange} status={status} done={() => keepYours(record)} />
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
 * (DESIGN.md Overview). Every control names its key, so clicking teaches the
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
  status,
  done,
}: {
  editor: Editor;
  shape: EditorShape;
  linking: string | null;
  setLinking: (href: string | null) => void;
  openLink: () => void;
  range: { current: { from: number; to: number } | null };
  status?: SaveState;
  /** What `⌘⏎` does before it lets go, for the button that stands in for it. */
  done: () => void;
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
        {/* the tile header says this too; on a phone with the keyboard up the header is off screen and this line is not */}
        {status !== undefined && status !== 'idle' && <Saving state={status} testId="saving-line" />}
        {linking !== null ? (
          <>
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
            {/* the same two ends for a hand with no keys (issue 11): `apply` is `⏎`, `cancel` is `esc` — cancelling the link, never the document */}
            <button type="button" className="gf-mode-btn" title="apply · ⏎" data-testid="link-apply" onClick={commit}>
              apply
            </button>
            <button type="button" className="gf-mode-btn" title="cancel · esc" data-testid="link-cancel" onClick={() => close(() => restore().run())}>
              cancel
            </button>
          </>
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
          // `done` is what `⌘⏎` does — flush and let go — as a button, for a finger (issue 11); the document saves itself either way
          <button
            type="button"
            className="gf-mode-btn gf-mode-done"
            title="done · ⌘⏎"
            data-testid="editor-done"
            onClick={() => {
              done();
              (editor.view.dom as HTMLElement).blur();
            }}
          >
            <kbd className="gf-kbd">⌘⏎</kbd> done
          </button>
        )}
      </div>
    </div>
  );
}
