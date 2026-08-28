import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import { slugPath } from '@goblin/shared';
import { useKey } from '../keys';
import { useApp, useCreateProject, useEvents, usePatchApp, useProjects } from '../queries';
import { useCrumb } from '../shell';
import { Empty, History, InlineForm, Kbd, Kv, Tile } from '../ui';
import { appBody, appFormFields } from './Apps';
import { AboutTile, NotFound, useAppNamer, useSlugParam } from './Entity';
import { ProjectRows, projectBody, projectFormFields } from './Projects';

export function AppView() {
  const { id } = useSlugParam('apps', undefined);
  const app = useApp(id);
  if (app.isError || id === null) return <NotFound what="app" />;
  if (!app.data) return <Empty>loading…</Empty>;
  return <AppLoaded app={app.data} />;
}

function AppLoaded({ app }: { app: NonNullable<ReturnType<typeof useApp>['data']> }) {
  useCrumb(app.name);
  const { redirect } = useSlugParam('apps', app);
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const projects = useProjects({ app_id: app.id, archived: showArchived });
  const events = useEvents('app', app.id);
  const create = useCreateProject();
  const patch = usePatchApp(app.id);
  const appName = useAppNamer();
  const nav = useNavigate();
  useKey('n', useCallback(() => setCreating(true), []));
  if (redirect) return redirect;

  return (
    <>
      <h1 className="gf-title" data-testid="page-title">
        {app.name}
      </h1>
      <Tile
        label="projects"
        subtitle={projects.data ? String(projects.data.length) : undefined}
        keys={
          <>
            <Kbd>n</Kbd> new
          </>
        }
        focus
        testId="projects-tile"
      >
        {creating && (
          <InlineForm
            testId="new-project-form"
            fields={projectFormFields(undefined, false)}
            submitLabel="create project"
            onCancel={() => setCreating(false)}
            onSubmit={async (v) => {
              const p = await create.mutateAsync({ ...projectBody(v), app_id: app.id });
              setCreating(false);
              nav(slugPath('projects', p));
            }}
          />
        )}
        {projects.data?.length === 0 && !creating && <Empty>no projects — press n</Empty>}
        {projects.data && <ProjectRows projects={projects.data} />}
        <label className="gf-toggle">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> show archived
        </label>
      </Tile>
      <Tile label="tickets" subtitle="0">
        <Empty>tickets arrive with the board</Empty>
      </Tile>
      <AboutTile
        kind="app"
        entity={app}
        fields={appFormFields}
        initial={{ name: app.name, repository_url: app.repository_url ?? '', default_branch: app.default_branch ?? '', description: app.description }}
        toBody={appBody}
        patch={(b) => patch.mutateAsync(b)}
        facts={
          <Kv
            rows={[
              ['name', app.name],
              ['repository', app.repository_url ? <a href={app.repository_url}>{app.repository_url}</a> : '—'],
              ['branch', app.default_branch ?? '—'],
              ['description', app.description || '—'],
            ]}
          />
        }
      />
      <Tile label="history" subtitle={events.data ? String(events.data.length) : undefined}>
        <History events={events.data} appName={appName} />
      </Tile>
    </>
  );
}
