import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import { slugPath } from '@goblin/shared';
import { useKey } from '../keys';
import { useApps, useCreateApp } from '../queries';
import { useCrumb } from '../shell';
import { Chip, Empty, InlineForm, Kbd, Row, Tile } from '../ui';

export const appFormFields = [
  { name: 'name', label: 'name' },
  { name: 'repository_url', label: 'repository url', placeholder: 'https://github.com/…' },
  { name: 'default_branch', label: 'default branch', placeholder: 'main' },
  { name: 'description', label: 'description', kind: 'textarea' as const },
];

export const appBody = (v: Record<string, string>) => ({
  name: v.name ?? '',
  repository_url: v.repository_url ? v.repository_url : null,
  default_branch: v.default_branch ? v.default_branch : null,
  description: v.description ?? '',
});

export function AppsPage() {
  useCrumb('apps');
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const apps = useApps(showArchived);
  const create = useCreateApp();
  const nav = useNavigate();
  useKey('n', useCallback(() => setCreating(true), []));

  return (
    <Tile
      label="apps"
      subtitle={apps.data ? `${apps.data.length}` : undefined}
      keys={
        <>
          <Kbd>n</Kbd> new
        </>
      }
      focus
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
      {apps.data?.length === 0 && !creating && <Empty>no apps yet — press n</Empty>}
      <div className="gf-rows" data-testid="apps-list">
        {apps.data?.map((a) => (
          <Row
            key={a.id}
            to={slugPath('apps', a)}
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
