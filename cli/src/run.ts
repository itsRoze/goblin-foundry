/**
 * `gf` is a thin JSON-in/JSON-out client of the API (ADR-0004). Handlers take
 * an injected `fetch` so tests drive them against the in-process Hono app.
 */
export type GfFetch = (path: string, init?: RequestInit) => Promise<Response>;

export interface GfResult {
  code: number;
  out: string;
}

const USAGE = `usage: gf <command>

commands:
  settings   print installation settings as JSON`;

export async function runGf(argv: string[], deps: { fetch: GfFetch }): Promise<GfResult> {
  const [command] = argv;
  switch (command) {
    case 'settings': {
      const res = await deps.fetch('/api/settings');
      const body = await res.text();
      return { code: res.ok ? 0 : 1, out: body };
    }
    case undefined:
    case 'help':
    case '--help':
      return { code: command === undefined ? 1 : 0, out: USAGE };
    default:
      return { code: 1, out: `gf: unknown command '${command}'\n\n${USAGE}` };
  }
}
