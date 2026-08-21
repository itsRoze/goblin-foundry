import { useEffect, useState } from 'react';
import { formatRef, parseRef } from '@goblin/schema';

export type Route =
  | { name: 'board' }
  | { name: 'ticket'; key: string; shortId: number }
  | { name: 'ticket-legacy'; shortId: number }
  | { name: 'run'; runId: string };

export function parse(hash: string): Route {
  const path = hash.replace(/^#/, '');
  const canonical = /^\/([A-Za-z][A-Za-z0-9]*-\d+)$/.exec(path);
  if (canonical) {
    const ref = parseRef(canonical[1]!);
    if (ref) return { name: 'ticket', key: ref.key, shortId: ref.shortId };
  }
  // The pre-ref-migration link shape: resolves only when exactly one project
  // has that number, and rewrites itself to canonical form when it does.
  const legacy = /^\/t\/(\d+)$/.exec(path);
  if (legacy) return { name: 'ticket-legacy', shortId: Number(legacy[1]) };
  const run = /^\/r\/(.+)$/.exec(path);
  if (run) return { name: 'run', runId: run[1]! };
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
};
