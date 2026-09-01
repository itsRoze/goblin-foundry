import { useState, type ReactNode } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { parseSlugId, slugPath, type App } from '@goblin/shared';
import { ProblemError } from '../api';
import { MarkdownField, Saving, focusEditor, type SaveState, type Saver } from '../editor';
import { useKey } from '../keys';
import { useApps, useIntent } from '../queries';
import { Chip, Empty, InlineForm, Tile, type Field } from '../ui';

/** `/apps/<slug>-<id>`: the id resolves; a stale slug redirects to the current one. */
export function useSlugParam(kind: 'apps' | 'projects', entity: { id: number; name: string } | undefined) {
  const { slugId = '' } = useParams();
  const parsed = parseSlugId(slugId);
  const id = parsed?.id ?? null;
  const canonical = entity ? slugPath(kind, entity) : null;
  const redirect = canonical && canonical !== `/${kind}/${slugId}` ? <Navigate to={canonical} replace /> : null;
  return { id, redirect };
}

export const NotFound = ({ what }: { what: string }) => (
  <Tile label={what} focus>
    <Empty>not found — it may be in the trash</Empty>
  </Tile>
);

/** The app name for an event line; archived apps count, trashed ones become "app #id". */
export function useAppNamer(): (id: unknown) => string {
  const apps = useApps(true);
  return (id) => apps.data?.find((a) => a.id === id)?.name ?? `app #${String(id)}`;
}

/**
 * The `about` tile: key/value facts (one of which is the always-live
 * description), an `edit` button for the fields that are not text — a name, a
 * repository, an app — and the archive / trash intents as flat buttons.
 * Shared by the App and Project views. `e` belongs to the editor now, not to
 * a mode (DESIGN.md §8).
 */
export function AboutTile<Body>({
  kind,
  entity,
  facts,
  fields,
  initial,
  toBody,
  patch,
  saving,
}: {
  kind: 'app' | 'project';
  entity: { id: number; name: string; archived_at: string | null };
  facts: ReactNode;
  fields: Field[];
  initial: Record<string, string>;
  toBody: (v: Record<string, string>) => Body;
  patch: (body: Body) => Promise<unknown>;
  /** What the always-live description is doing, said in the tile header. */
  saving?: SaveState;
}) {
  const [editing, setEditing] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const intent = useIntent(kind, entity.id);
  const nav = useNavigate();
  useKey('e', focusEditor);

  const run = async (name: 'archive' | 'unarchive' | 'trash') => {
    setRefusal(null);
    try {
      await intent.mutateAsync(name);
      if (name === 'trash') nav(`/${kind}s`);
    } catch (e) {
      setRefusal(e instanceof ProblemError ? e.line : String(e));
    }
  };

  return (
    <Tile
      label="about"
      subtitle={entity.archived_at ? <Chip tone="draft">archived</Chip> : undefined}
      keys={
        <>
          {saving && <Saving state={saving} />}
          <button type="button" className="gf-plus" aria-label={`edit ${kind}`} onClick={() => setEditing(true)}>
            edit
          </button>
        </>
      }
      testId="about-tile"
    >
      {editing ? (
        <InlineForm
          testId="edit-form"
          fields={fields}
          initial={initial}
          submitLabel="save"
          onCancel={() => setEditing(false)}
          onSubmit={async (v) => {
            await patch(toBody(v));
            setEditing(false);
          }}
        />
      ) : (
        facts
      )}
      {refusal && (
        <p className="gf-refusal" role="alert">
          {refusal}
        </p>
      )}
      <div className="gf-actions">
        {entity.archived_at ? (
          <button className="gf-btn" onClick={() => run('unarchive')}>
            unarchive
          </button>
        ) : (
          <button className="gf-btn" onClick={() => run('archive')}>
            archive
          </button>
        )}
        <button className="gf-btn is-danger" onClick={() => run('trash')}>
          trash
        </button>
      </div>
    </Tile>
  );
}

/**
 * An App's or a Project's description: a sentence or two, so the inline shape
 * (emphasis, code, links). Both views render it as the `description` row of
 * their `about` tile, and it saves itself like every other field on a view.
 */
export function DescriptionField({
  kind,
  value,
  saving,
  patch,
}: {
  kind: 'app' | 'project';
  value: string;
  saving: Saver;
  patch: (body: { description: string }) => Promise<unknown>;
}) {
  return (
    <MarkdownField
      shape="inline"
      label="description"
      placeholder={`what this ${kind === 'app' ? 'product' : 'project'} is`}
      value={value}
      onSave={(description) => saving.run(() => patch({ description }))}
      testId={`${kind}-description`}
    />
  );
}

export const appOptions = (apps: App[] | undefined) => [{ value: '', label: 'no app' }, ...(apps ?? []).filter((a) => !a.archived_at).map((a) => ({ value: String(a.id), label: a.name }))];
