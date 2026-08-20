import { useEffect, useState } from 'react';
import { useConnectionState } from '@rocicorp/zero/react';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:4848';

export type Health =
  | { ok: true }
  | { ok: false; label: string; detail: string; recover?: () => void; recoverLabel?: string };

type Probe = { status: string; db: string } | { unreachable: true } | { broken: string };

/**
 * Is the factory actually answering?
 *
 * Zero's own connection state only covers the socket to zero-cache. It stays
 * green when the API is down — and since the API is what resolves every named
 * query, the board then renders as an empty factory rather than a broken one.
 * So this watches both, and reports the API first because that is the failure
 * that looks like nothing being wrong.
 */
export function useHealth(intervalMs = 10_000): Health {
  const connection = useConnectionState();
  const [probe, setProbe] = useState<Probe | null>(null);
  // "Connecting" is only healthy for a moment. A client wedged on a blocked
  // IndexedDB never reaches `disconnected`, so watching only for that state
  // reports green while nothing syncs at all.
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    if (connection.name === 'connected') { setStuck(false); return; }
    const timer = setTimeout(() => setStuck(true), 15_000);
    return () => clearTimeout(timer);
  }, [connection.name]);

  useEffect(() => {
    let live = true;
    const check = async () => {
      try {
        const res = await fetch(`${BASE}/healthz`, { signal: AbortSignal.timeout(4000) });
        // A 500 with an HTML error page is a different failure from nothing
        // answering at all, and saying so is the whole point of this bar.
        if (!res.ok) {
          if (live) setProbe({ broken: `the api answered ${res.status}` });
          return;
        }
        const body = await res.json() as { status: string; db: string };
        if (live) setProbe(body);
      } catch (e) {
        const reason = e instanceof SyntaxError ? 'the api answered something that is not JSON' : null;
        if (live) setProbe(reason ? { broken: reason } : { unreachable: true });
      }
    };
    void check();
    const timer = setInterval(check, intervalMs);
    return () => { live = false; clearInterval(timer); };
  }, [intervalMs]);

  if (probe && 'unreachable' in probe) {
    return { ok: false, label: 'api unreachable', detail: `nothing is answering on ${BASE} — run: just api` };
  }
  if (probe && 'broken' in probe) {
    return { ok: false, label: 'api failing', detail: `${probe.broken} — check the api's logs` };
  }
  if (probe && probe.db !== 'ok') {
    return { ok: false, label: 'database unreachable', detail: `the api is up but Postgres is not — run: just up (${probe.db})` };
  }
  if (connection.name === 'disconnected' || connection.name === 'error' || connection.name === 'closed') {
    const reason = 'reason' in connection && typeof connection.reason === 'string' ? connection.reason : connection.name;
    // Zero stops retrying after about a minute, and a client that has given up
    // stays given up: calling connection.connect() on it returns without error
    // and without reconnecting. A reload is what actually recovers.
    return {
      ok: false, label: 'not syncing',
      detail: `zero-cache is not connected (${reason})`,
      recover: () => location.reload(),
      recoverLabel: 'reload',
    };
  }
  if (stuck && connection.name === 'connecting') {
    return {
      ok: false, label: 'not syncing',
      detail: 'the sync client has been connecting for a while — if it never settles, close every tab on this origin and open one fresh',
      recover: () => location.reload(),
      recoverLabel: 'reload',
    };
  }
  if (connection.name === 'needs-auth') {
    return { ok: false, label: 'not syncing', detail: 'zero-cache rejected the token' };
  }
  return { ok: true };
}
