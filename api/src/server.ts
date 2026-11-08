import { createApp } from './app';
import { openDb } from './db';
import { admitOnly } from './peers';
import { DEFAULT_PORT, formatAllow, notANetwork, parseAllow, type Network } from '@goblin/shared';

/**
 * No auth (ADR-0003), so who can reach the API is decided by where it listens.
 * Without `GF_ALLOW` that is `127.0.0.1` and nothing else. With it (GF-186),
 * the server also listens on `0.0.0.0` so a VM on this Mac can reach it, and
 * that listener answers only the networks listed: everyone else gets a 403.
 * Binding the VM bridge's own address instead would fail whenever no VM is
 * running.
 *
 * On macOS the `127.0.0.1` listener stays even then, because macOS lets a
 * `0.0.0.0` and a `127.0.0.1` listener share a port: without it a `bun dev`
 * beside an allowing agent would bind cleanly and take every loopback request.
 * Linux refuses that pair with EADDRINUSE, and its `0.0.0.0` listener alone
 * already turns away a second server's `127.0.0.1` bind, so elsewhere the
 * guarded listener is the only one (loopback is always admitted).
 *
 * The LaunchAgent (ticket 13) and `bun dev` are this same server on this same
 * port, so a taken port is not a crash to report but a choice to state: one of
 * the two has to move, and this says which lever moves which.
 */
function serve(port: number, allow: Network[], fetch: (request: Request) => Response | Promise<Response>) {
  try {
    if (allow.length === 0) return Bun.serve({ hostname: '127.0.0.1', port, fetch });
    const guarded = admitOnly(allow, fetch);
    if (process.platform !== 'darwin') return Bun.serve({ hostname: '0.0.0.0', port, fetch: guarded });
    const loopback = Bun.serve({ hostname: '127.0.0.1', port, fetch });
    Bun.serve({ hostname: '0.0.0.0', port: loopback.port, fetch: guarded });
    return loopback;
  } catch (error) {
    if ((error as { code?: string }).code !== 'EADDRINUSE') throw error;
    console.error(`port ${port} is taken — stop the tracker with \`goblin service stop\`, or set GF_PORT to run beside it.`);
    process.exit(1);
  }
}

const allowed = parseAllow(process.env.GF_ALLOW ?? '');
if (!allowed.ok) {
  console.error(`GF_ALLOW: ${notANetwork(allowed.entry)}`);
  process.exit(1);
}
const allow = allowed.networks;

const port = Number(process.env.GF_PORT ?? DEFAULT_PORT);
const handle = await openDb();
const server = serve(port, allow, createApp(handle.db).fetch);
console.log(`goblin-foundry  http://127.0.0.1:${server.port}  db=${handle.path}${allow.length === 0 ? '' : `  allow=${formatAllow(allow)}`}`);
