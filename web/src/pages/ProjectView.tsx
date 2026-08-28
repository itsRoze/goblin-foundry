import { Link } from 'react-router';
import { slugPath } from '@goblin/shared';
import { useApps, useEvents, usePatchProject, useProject } from '../queries';
import { useCrumb } from '../shell';
import { Empty, History, Kv, Tile } from '../ui';
import { AboutTile, NotFound, appOptions, useAppNamer, useSlugParam } from './Entity';

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
  const patch = usePatchProject(project.id);
  const appName = useAppNamer();
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
      <Tile label="tickets" subtitle="0" focus>
        <Empty>tickets arrive with the board</Empty>
      </Tile>
      <AboutTile
        kind="project"
        entity={project}
        fields={[
          { name: 'name', label: 'name' },
          { name: 'description', label: 'description', kind: 'textarea' },
          { name: 'app_id', label: 'app', kind: 'select', options: appOptions(apps.data) },
        ]}
        initial={{ name: project.name, description: project.description, app_id: project.app_id === null ? '' : String(project.app_id) }}
        toBody={(v) => ({ name: v.name ?? '', description: v.description ?? '', app_id: v.app_id ? Number(v.app_id) : null })}
        patch={(b) => patch.mutateAsync(b)}
        facts={
          <Kv
            rows={[
              ['name', project.name],
              ['app', app ? <Link to={slugPath('apps', app)}>{app.name}</Link> : 'no app yet'],
              ['description', project.description || '—'],
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
