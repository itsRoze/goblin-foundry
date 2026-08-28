import { createApp } from './app';
import { openDb } from './db';

const port = Number(process.env.GF_PORT ?? 4747);
const handle = await openDb();
const app = createApp(handle.db);

// localhost only — no auth in S1 (ADR-0004), so never bind to 0.0.0.0.
const server = Bun.serve({ hostname: '127.0.0.1', port, fetch: app.fetch });
console.log(`goblin-foundry  http://127.0.0.1:${server.port}  db=${handle.path}`);
