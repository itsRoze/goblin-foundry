import { useState } from 'react';
import { useNavigate } from 'react-router';
import { slugPath, type App, type Project } from '@goblin/shared';
import { useApps, useCreateProject, useProjects } from '../queries';
import { useCrumb } from '../shell';
import { Chip, Empty, InlineForm, Plus, Row, Tile } from '../ui';

export const projectFormFields = (apps: App[] | undefined, withApp: boolean) => [
  { name: 'name', label: 'name' },
  { name: 'description', label: 'description', kind: 'textarea' as const },
  ...(withApp
    ? [{ name: 'app_id', label: 'app', kind: 'select' as const, options: [{ value: '', label: 'no app yet' }, ...(apps ?? []).map((a) => ({ value: String(a.id), label: a.name }))] }]
    : []),
];

/** A form that does not carry the description leaves it alone — the about tile's description saves itself. */
export const projectBody = (v: Record<string, string>) => ({
  name: v.name ?? '',
  ...(v.description === undefined ? {} : { description: v.description }),
  app_id: v.app_id ? Number(v.app_id) : null,
});

export function ProjectRows({ projects }: { projects: Project[] }) {
  return (
    <div className="gf-rows">
      {projects.map((p) => (
        <Row
          key={p.id}
          to={slugPath('projects', p)}
          title={p.name}
          meta={p.description || undefined}
          trailing={p.archived_at ? <Chip tone="draft">archived</Chip> : undefined}
        />
      ))}
    </div>
  );
}

/** All projects grouped by App, with a "no app" group for the orphans. */
export function ProjectsPage() {
  useCrumb('projects');
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const apps = useApps(true);
  const projects = useProjects({ archived: showArchived });
  const create = useCreateProject();
  const nav = useNavigate();

  const groups: { key: string; label: string; items: Project[] }[] = [];
  if (projects.data && apps.data) {
    for (const a of apps.data) {
      const items = projects.data.filter((p) => p.app_id === a.id);
      if (items.length) groups.push({ key: `app-${a.id}`, label: a.name, items });
    }
    const orphans = projects.data.filter((p) => p.app_id === null);
    if (orphans.length) groups.push({ key: 'none', label: 'no app', items: orphans });
  }

  return (
    <Tile
      label="projects"
      subtitle={projects.data ? `${projects.data.length} · by app` : undefined}
      keys={<Plus label="new project" onClick={() => setCreating(true)} />}
      focus
      testId="projects-tile"
    >
      {creating && (
        <InlineForm
          testId="new-project-form"
          fields={projectFormFields(apps.data?.filter((a) => !a.archived_at), true)}
          submitLabel="create project"
          onCancel={() => setCreating(false)}
          onSubmit={async (v) => {
            const p = await create.mutateAsync(projectBody(v));
            setCreating(false);
            nav(slugPath('projects', p));
          }}
        />
      )}
      {projects.data?.length === 0 && !creating && <Empty>no projects yet — click +</Empty>}
      {groups.map((g) => (
        <div key={g.key} className="gf-group" data-testid={`group-${g.key}`}>
          <div className="gf-group-head">{g.label}</div>
          <ProjectRows projects={g.items} />
        </div>
      ))}
      <label className="gf-toggle">
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> show archived
      </label>
    </Tile>
  );
}
