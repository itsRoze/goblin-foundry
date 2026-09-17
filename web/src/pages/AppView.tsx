import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { slugPath } from '@goblin/shared';
import { useOpensCreate } from '../creating';
import { useCursor } from '../desk';
import { useSaving } from '../editor';
import { useApp, useCreateProject, useEvents, usePatchApp, useProjects, useTickets } from '../queries';
import { useCrumb } from '../shell';
import { TicketRows, useNewTicket } from '../tickets';
import { Empty, Hint, History, InlineForm, Kv, Plus, Tile, describeEvent } from '../ui';
import { appBody, appFormFields } from './Apps';
import { AboutTile, DescriptionField, NotFound, useAppNamer, useSlugParam } from './Entity';
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
  const tickets = useTickets({ app_id: app.id });
  const events = useEvents('app', app.id);
  const create = useCreateProject();
  const patch = usePatchApp(app.id);
  const appName = useAppNamer();
  const nav = useNavigate();
  const newTicket = useNewTicket({ app_id: app.id });
  const about = useSaving();
  useOpensCreate('project', () => setCreating(true));
  const cursor = useCursor({ tile: 'projects', columns: [(projects.data ?? []).map((p) => slugPath('projects', p))], pathOf: (path) => path });
  if (redirect) return redirect;

  return (
    <>
      <h1 className="gf-title" data-testid="page-title">
        {app.name}
      </h1>
      <Tile
        label="projects"
        subtitle={projects.data ? String(projects.data.length) : undefined}
        keys={<Plus label="new project" onClick={() => setCreating(true)} />}
        navigable
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
        {projects.data?.length === 0 && !creating && <Empty>no projects — click +</Empty>}
        {projects.data && <ProjectRows projects={projects.data} cursor={cursor.isAt} />}
        <label className="gf-toggle">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> show archived
        </label>
      </Tile>
      <Tile
        label="tickets"
        subtitle={tickets.data ? String(tickets.data.length) : undefined}
        keys={
          <>
            {/* the board, filtered to this app — the same Filter a chip would set (issue 06) */}
            <Link className="gf-tile-link" to={`/?app_id=${app.id}`}>
              board
            </Link>
            <Hint k="c" onClick={newTicket.open}>
              new
            </Hint>
          </>
        }
        navigable
        testId="tickets-tile"
      >
        {newTicket.form}
        <TicketRows tickets={tickets.data} />
      </Tile>
      <AboutTile
        kind="app"
        entity={app}
        fields={appFormFields.filter((f) => f.name !== 'description')}
        initial={{ name: app.name, repository_url: app.repository_url ?? '', default_branch: app.default_branch ?? '' }}
        toBody={appBody}
        saving={about.state}
        patch={(b) => patch.mutateAsync(b)}
        facts={
          <Kv
            rows={[
              ['name', app.name],
              ['repository', app.repository_url ? <a href={app.repository_url}>{app.repository_url}</a> : '—'],
              ['branch', app.default_branch ?? '—'],
              ['description', <DescriptionField kind="app" value={app.description} saving={about} patch={(b) => patch.mutateAsync(b)} />],
            ]}
          />
        }
      />
      <Tile label="history" subtitle={events.data ? String(events.data.length) : undefined}>
        <History events={events.data} describe={(e) => describeEvent(e, appName)} />
      </Tile>
    </>
  );
}
