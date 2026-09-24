import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { CurrentTicketProvider, useCurrentTicket } from './current';
import { CreateProvider } from './creating';
import { DeskProvider, useScreenEscape } from './desk';
import { useKey, useKeyMap } from './keys';
import { Palette, type PaletteMode } from './palette-view';
import { useApps, useProjects } from './queries';
import { BulkStatus, SelectingProvider, useSelecting } from './selecting';
import { Kbd } from './ui';
import { useTileLayout } from './tile-layout';

const CrumbContext = createContext<(crumb: string) => void>(() => {});

/** The palette is the shell's, and a control on a page may open it: the board's `status` and `move` are taps on the same panel `s` opens. */
const PaletteContext = createContext<(mode: PaletteMode) => void>(() => {});
export const useOpenPalette = () => useContext(PaletteContext);

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

/**
 * The three things every screen shares: which tile keys are addressing
 * (`desk`), which Ticket they are about (`current`), and where the create
 * forms are (`creating`). The palette and `a s d` are bound once, here, and
 * reach the screen through those — which is what keeps a key from doing more
 * than the button beside it.
 */
export function Shell() {
  return (
    <CurrentTicketProvider>
      <SelectingProvider>
        <CreateProvider>
          <DeskProvider>
            <ShellBody />
          </DeskProvider>
        </CreateProvider>
      </SelectingProvider>
    </CurrentTicketProvider>
  );
}

function ShellBody() {
  const desk = useTileLayout();
  const [crumb, setCrumb] = useState('');
  const apps = useApps();
  const projects = useProjects();
  const nav = useNavigate();
  const current = useCurrentTicket();
  const screenEscape = useScreenEscape();
  const [palette, setPalette] = useState<PaletteMode | null>(null);
  const closePalette = useCallback(() => setPalette(null), []);
  for (const w of workspaces) useKey(String(w.n), () => nav(w.to));
  useKey('k', () => setPalette('anything'), { meta: true });

  /**
   * `esc` closes the topmost open thing and then walks back. Everything that
   * holds the caret — a form, a picker, the filter input, an editor — already
   * answers `esc` itself and silences the global keys while it does; what is
   * left is the palette, then whatever the screen says it has open, then the
   * way back. `history.state.idx` is React Router's own count of how deep into
   * this session we are, so `back` never steps out of the app.
   */
  const escape = () => {
    if (palette !== null) return closePalette();
    if (screenEscape()) return;
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) void nav(-1);
    else void nav('/');
  };

  /**
   * `a s d` act on the current Ticket, and do nothing at all where there is
   * not one. They ask the *ref* rather than the key in state: the screen puts
   * its verbs there in the same commit that draws the Cursor, so a key pressed
   * straight after `j` acts on the card you can already see rather than on the
   * one before it.
   */
  useKeyMap({
    // a Selection outranks the Cursor for as long as it exists: the keys must never mean one card while several are ticked
    a: () => (current.selectionActions.current ? current.selectionActions.current.act({ kind: 'transition', name: 'approve' }) : current.actions.current?.move('approve')),
    s: () => (current.selectionActions.current ?? current.actions.current) !== null && setPalette('status'),
    d: () => (current.selectionActions.current ? current.selectionActions.current.explainDependencies() : current.actions.current?.blockedBy()),
    Escape: escape,
  });

  // a bulk action outlives the board it was sent from; off the board, the shell is where it reports
  const selecting = useSelecting();
  const { pathname } = useLocation();
  const reporting = pathname !== '/' && (selecting.pending !== null || selecting.outcome !== null);

  return (
    <CrumbContext.Provider value={setCrumb}>
      <header className="gf-bar">
        <nav className="gf-ws" aria-label="workspaces">
          {workspaces.map((w) => (
            <NavLink key={w.n} to={w.to} end={w.to === '/'} className={({ isActive }) => (isActive ? 'is-on' : '')}>
              {w.n} <span className="gf-ws-label">{w.label}</span>
            </NavLink>
          ))}
        </nav>
        <span className="gf-crumb" data-testid="crumb">
          {crumb}
        </span>
        <span className="gf-counts">
          <span>
            <b>{apps.data?.length ?? '·'}</b>
            <span className="gf-count-label">apps</span>
          </span>
          <span>
            <b>{projects.data?.length ?? '·'}</b>
            <span className="gf-count-label">projects</span>
          </span>
          <NavLink to="/trash" className={({ isActive }) => (isActive ? 'is-on' : '')}>
            trash
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => (isActive ? 'is-on' : '')}>
            settings
          </NavLink>
          {/* the key is the control: pressing it and clicking it open the same panel */}
          <button type="button" className="gf-bar-key" aria-label="command palette" data-testid="open-palette" onClick={() => setPalette('anything')}>
            <Kbd>⌘K</Kbd>
          </button>
        </span>
      </header>
      {reporting && (
        <div className="gf-bulk-strip">
          <BulkStatus onDismiss={() => selecting.report(null)} />
        </div>
      )}
      <main className="gf-desk" ref={desk}>
        <PaletteContext.Provider value={setPalette}>
          <Outlet />
        </PaletteContext.Provider>
      </main>
      {palette !== null && <Palette mode={palette} onClose={closePalette} />}
    </CrumbContext.Provider>
  );
}
