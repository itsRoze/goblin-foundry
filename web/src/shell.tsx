import { createContext, useContext, useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { useApps, useProjects } from './queries';
import { useKey } from './keys';

const CrumbContext = createContext<(crumb: string) => void>(() => {});

/** Pages announce where they are; the bar shows it as `app / project`. */
export function useCrumb(crumb: string) {
  const set = useContext(CrumbContext);
  useEffect(() => {
    set(crumb);
    return () => set('');
  }, [crumb, set]);
}

const workspaces = [
  { n: 1, label: 'board', to: '/' },
  { n: 2, label: 'project', to: '/projects' },
  { n: 3, label: 'app', to: '/apps' },
];

export function Shell() {
  const [crumb, setCrumb] = useState('');
  const apps = useApps();
  const projects = useProjects();
  const nav = useNavigate();
  for (const w of workspaces) useKey(String(w.n), () => nav(w.to));

  return (
    <CrumbContext.Provider value={setCrumb}>
      <header className="gf-bar">
        <nav className="gf-ws" aria-label="workspaces">
          {workspaces.map((w) => (
            <NavLink key={w.n} to={w.to} end={w.to === '/'} className={({ isActive }) => (isActive ? 'is-on' : '')}>
              {w.n} {w.label}
            </NavLink>
          ))}
        </nav>
        <span className="gf-crumb" data-testid="crumb">
          {crumb}
        </span>
        <span className="gf-counts">
          <span>
            <b>{apps.data?.length ?? '·'}</b>apps
          </span>
          <span>
            <b>{projects.data?.length ?? '·'}</b>projects
          </span>
          <NavLink to="/trash" className={({ isActive }) => (isActive ? 'is-on' : '')}>
            trash
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => (isActive ? 'is-on' : '')}>
            settings
          </NavLink>
        </span>
      </header>
      <main className="gf-desk">
        <Outlet />
      </main>
    </CrumbContext.Provider>
  );
}
