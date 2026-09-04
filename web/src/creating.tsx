import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { CreateWhat } from './palette';

/**
 * The three create forms, reachable by name. `c` and the `+` buttons open the
 * form on the screen you are standing on; `⌘K` has to reach the same three
 * from anywhere, so a page that owns one says so, and the palette either
 * presses it or goes to the page that has it and asks again from there
 * (`location.state`, the same way `d` carries a picker to the Ticket view).
 */

/** Where each form lives when the screen you are on does not have it. */
const HOME: Record<CreateWhat, string> = { ticket: '/', app: '/apps', project: '/projects' };

type Openers = Partial<Record<CreateWhat, () => void>>;

const CreateContext = createContext<{ current: Openers } | null>(null);

export function CreateProvider({ children }: { children: ReactNode }) {
  const openers = useRef<Openers>({});
  const value = useMemo(() => openers, []);
  return <CreateContext.Provider value={value}>{children}</CreateContext.Provider>;
}

function useOpeners() {
  const openers = useContext(CreateContext);
  if (openers === null) throw new Error('a create form outside the shell');
  return openers;
}

/**
 * This screen has the form for `what`. Registering it also consumes the
 * request an arriving navigation carried, and clears it from the address, so
 * that stepping back to this page later does not open the form again.
 */
export function useOpensCreate(what: CreateWhat, open: () => void) {
  const openers = useOpeners();
  const { pathname, search, state } = useLocation();
  const nav = useNavigate();
  // `open` is a fresh closure every render, so it is reached through a ref rather than watched
  const latest = useRef(open);
  useEffect(() => {
    latest.current = open;
    openers.current[what] = open;
    return () => {
      delete openers.current[what];
    };
  });
  const asked = (state as { create?: CreateWhat } | null)?.create === what;
  useEffect(() => {
    if (!asked) return;
    latest.current();
    nav(pathname + search, { replace: true, state: null });
  }, [asked, nav, pathname, search]);
}

/** Open a create form from anywhere — here if this screen has it, else on the screen that does. */
export function useCreate(): (what: CreateWhat) => void {
  const openers = useOpeners();
  const nav = useNavigate();
  return useCallback(
    (what: CreateWhat) => {
      const open = openers.current[what];
      if (open) open();
      else nav(HOME[what], { state: { create: what } });
    },
    [openers, nav],
  );
}
