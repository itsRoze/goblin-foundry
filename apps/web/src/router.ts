import { useEffect, useState } from 'react';

export type Route =
  | { name: 'board' }
  | { name: 'ticket'; shortId: number }
  | { name: 'run'; runId: string };

function parse(hash: string): Route {
  const path = hash.replace(/^#/, '');
  const ticket = /^\/t\/(\d+)$/.exec(path);
  if (ticket) return { name: 'ticket', shortId: Number(ticket[1]) };
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
  ticket: (shortId: number) => `#/t/${shortId}`,
  run: (runId: string) => `#/r/${runId}`,
};
