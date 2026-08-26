import { useEffect, useState } from 'react';
import { formatRef, parseRef } from '@goblin/schema';

export type Route =
  | { name: 'board' }
  | { name: 'ticket'; key: string; shortId: number }
  | { name: 'ticket-legacy'; shortId: number }
  | { name: 'run'; runId: string }
  | { name: 'inbox'; itemId?: string };

export function parse(hash: string): Route {
  // A notification link may carry a query string for the push service's own
  // bookkeeping; every route below matches to end of string, so it has to
  // come off before any of them run or it ends up inside the last capture.
  const path = hash.replace(/^#\//, '').split('?')[0]!;
  // The pre-ref-migration link shape: resolves only when exactly one project
  // has that number, and rewrites itself to canonical form when it does.
  const legacy = /^t\/(\d+)$/.exec(path);
  if (legacy) return { name: 'ticket-legacy', shortId: Number(legacy[1]) };
  const run = /^r\/(.+)$/.exec(path);
  if (run) return { name: 'run', runId: run[1]! };
  // A deep link's item id is already prefixed by kind (round:/approval:/stuck:),
  // so one route carries it and the inbox infers the kind from the prefix.
  const inbox = /^inbox(?:\/(.+))?$/.exec(path);
  if (inbox) return { name: 'inbox', itemId: inbox[1] };
  // parseRef() is the ref grammar's one definition — no second regex here.
  const ref = parseRef(path);
  if (ref) return { name: 'ticket', key: ref.key, shortId: ref.shortId };
  return { name: 'board' };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(location.hash));
  useEffect(() => {
    const onHash = () => setRoute(parse(location.hash));
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);
  return route;
}

export const href = {
  board: '#/',
  ticket: (key: string, shortId: number) => `#/${formatRef(key, shortId)}`,
  run: (runId: string) => `#/r/${runId}`,
  inbox: '#/inbox',
  inboxItem: (itemId: string) => `#/inbox/${itemId}`,
};
