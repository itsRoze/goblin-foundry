import { useState } from 'react';
import { useNavigate } from 'react-router';
import { slugPath } from '@goblin/shared';
import { useOpensCreate } from '../creating';
import { useCursor } from '../desk';
import { useApps, useCreateApp } from '../queries';
import { useCrumb } from '../shell';
import { Chip, Empty, InlineForm, Plus, Row, Tile } from '../ui';

export const appFormFields = [
  { name: 'name', label: 'name' },
  { name: 'repository_url', label: 'repository url', placeholder: 'https://github.com/…' },
  { name: 'default_branch', label: 'default branch', placeholder: 'main' },
  { name: 'description', label: 'description', kind: 'textarea' as const },
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
