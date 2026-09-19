import { useState } from 'react';
import { useNavigate } from 'react-router';
import { REPOSITORY_EXAMPLES, slugPath } from '@goblin/shared';
import { fieldLabel } from '../api';
import { useOpensCreate } from '../creating';
import { useCursor } from '../desk';
import { useApps, useCreateApp } from '../queries';
import { useCrumb } from '../shell';
import { Chip, Empty, InlineForm, Plus, Row, Tile, type Field } from '../ui';

export const appFormFields: Field[] = [
  { name: 'name', label: 'name' },
  // labelled from the one place that knows what the GUI calls a wire field, so the
  // label above a field and the refusal under it cannot drift apart
  { name: 'repository_url', label: fieldLabel('repository_url'), placeholder: REPOSITORY_EXAMPLES },
  // a branch alone is a 422 (`DEFAULT_BRANCH_NEEDS_REPOSITORY`); the field says so before ⌘⏎ does.
  // Not `branchWithoutRepository`: that asks whether the pair is illegal, this asks whether the
  // field can be used at all, which is true before anything has been typed into it.
  { name: 'default_branch', label: fieldLabel('default_branch'), placeholder: 'main', inertWhen: (v) => !v.repository_url?.trim() },
  { name: 'description', label: 'description', kind: 'textarea' },
];

/** A form that does not carry the description leaves it alone — the about tile's description saves itself. */
export const appBody = (v: Record<string, string>) => ({
  name: v.name ?? '',
  repository_url: v.repository_url ? v.repository_url : null,
  default_branch: v.default_branch ? v.default_branch : null,
  ...(v.description === undefined ? {} : { description: v.description }),
});

export function AppsPage() {
  useCrumb('apps');
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const apps = useApps(showArchived);
  const create = useCreateApp();
  const nav = useNavigate();
  useOpensCreate('app', () => setCreating(true));
  // a row here opens and nothing else: the all-apps list has no buttons for a key to stand for
  const cursor = useCursor({ tile: 'apps', columns: [(apps.data ?? []).map((a) => slugPath('apps', a))], pathOf: (path) => path });

  return (
    <Tile
      label="apps"
      subtitle={apps.data ? `${apps.data.length}` : undefined}
      keys={<Plus label="new app" onClick={() => setCreating(true)} />}
      navigable
      testId="apps-tile"
    >
      {creating && (
        <InlineForm
          testId="new-app-form"
          fields={appFormFields}
          submitLabel="create app"
          onCancel={() => setCreating(false)}
          onSubmit={async (v) => {
            const app = await create.mutateAsync(appBody(v));
            setCreating(false);
            nav(slugPath('apps', app));
          }}
        />
      )}
      {apps.data?.length === 0 && !creating && <Empty>no apps yet — click +</Empty>}
      <div className="gf-rows" data-testid="apps-list">
        {apps.data?.map((a) => (
          <Row
            key={a.id}
            to={slugPath('apps', a)}
            cursor={cursor.isAt(slugPath('apps', a))}
            title={a.name}
            meta={a.repository_url ?? 'no repository'}
            trailing={a.archived_at ? <Chip tone="draft">archived</Chip> : undefined}
          />
        ))}
      </div>
      <label className="gf-toggle">
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> show archived
      </label>
    </Tile>
  );
}
