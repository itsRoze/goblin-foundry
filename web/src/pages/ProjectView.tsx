import { Link } from 'react-router';
import { slugPath } from '@goblin/shared';
import { MarkdownField, Saving, useSaving } from '../editor';
import { useApps, useEvents, usePatchProject, useProject, useTickets } from '../queries';
import { useCrumb } from '../shell';
import { TicketRows, useNewTicket } from '../tickets';
import { Empty, History, Kbd, Kv, Tile, describeEvent } from '../ui';
import { AboutTile, DescriptionField, NotFound, appOptions, useAppNamer, useSlugParam } from './Entity';

export function ProjectView() {
  const { id } = useSlugParam('projects', undefined);
  const project = useProject(id);
  if (project.isError || id === null) return <NotFound what="project" />;
  if (!project.data) return <Empty>loading…</Empty>;
  return <ProjectLoaded project={project.data} />;
}

function ProjectLoaded({ project }: { project: NonNullable<ReturnType<typeof useProject>['data']> }) {
  const apps = useApps(true);
  const app = apps.data?.find((a) => a.id === project.app_id);
  useCrumb(app ? `${app.name} / ${project.name}` : project.name);
  const { redirect } = useSlugParam('projects', project);
  const events = useEvents('project', project.id);
  const tickets = useTickets({ project_id: project.id });
  const patch = usePatchProject(project.id);
  const appName = useAppNamer();
  const newTicket = useNewTicket({ project_id: project.id });
  const about = useSaving();
  const design = useSaving();
  if (redirect) return redirect;

  return (
    <>
      <h1 className="gf-title" data-testid="page-title">
        {app && (
          <>
            <Link to={slugPath('apps', app)} className="gf-title-parent">
              {app.name}
            </Link>{' '}
            /{' '}
          </>
        )}
        {project.name}
      </h1>
      <Tile
        label="tickets"
        subtitle={tickets.data ? String(tickets.data.length) : undefined}
        keys={
          <>
            <Kbd>c</Kbd> new
          </>
        }
        focus
        testId="tickets-tile"
      >
        {newTicket}
        <TicketRows tickets={tickets.data} />
      </Tile>
      <Tile label="design" keys={<Saving state={design.state} />} testId="design-tile">
        <MarkdownField
          shape="block"
          label="project design"
          placeholder="no project design — the shape of this project goes here"
          value={project.design}
          onSave={(body) => design.run(() => patch.mutateAsync({ design: body }))}
          fill
          testId="design"
        />
      </Tile>
      <AboutTile
        kind="project"
        entity={project}
        fields={[
          { name: 'name', label: 'name' },
          { name: 'app_id', label: 'app', kind: 'select', options: appOptions(apps.data) },
        ]}
        initial={{ name: project.name, app_id: project.app_id === null ? '' : String(project.app_id) }}
        toBody={(v) => ({ name: v.name ?? '', app_id: v.app_id ? Number(v.app_id) : null })}
        saving={about.state}
        patch={(b) => patch.mutateAsync(b)}
        facts={
          <Kv
            rows={[
              ['name', project.name],
              ['app', app ? <Link to={slugPath('apps', app)}>{app.name}</Link> : 'no app yet'],
              ['description', <DescriptionField kind="project" value={project.description} saving={about} patch={(b) => patch.mutateAsync(b)} />],
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
