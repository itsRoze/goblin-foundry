import { createApp } from './app';
import { openDb } from './db';
import { DEFAULT_PORT } from '@goblin/shared';

/**
 * localhost only — no auth in S1 (ADR-0004), so never bind to 0.0.0.0.
 *
 * The LaunchAgent (ticket 13) and `bun dev` are this same server on this same
 * port, so a taken port is not a crash to report but a choice to state: one of
 * the two has to move, and this says which lever moves which.
 */
function serve(port: number, fetch: (request: Request) => Response | Promise<Response>) {
  try {
    return Bun.serve({ hostname: '127.0.0.1', port, fetch });
  } catch (error) {
    if ((error as { code?: string }).code !== 'EADDRINUSE') throw error;
    console.error(`port ${port} is taken — stop the tracker with \`goblin service stop\`, or set GF_PORT to run beside it.`);
    process.exit(1);
  }
}

const port = Number(process.env.GF_PORT ?? DEFAULT_PORT);
const handle = await openDb();
const server = serve(port, createApp(handle.db).fetch);
console.log(`goblin-foundry  http://127.0.0.1:${server.port}  db=${handle.path}`);
