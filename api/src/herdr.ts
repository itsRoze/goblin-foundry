import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { TerminalRequest, TerminalStep } from './terminal';

/**
 * Herdr 2, driven only through its two command-line tools: `herdr-app` is the
 * window (spaces, tabs, what is shown) and `hc` is its core (the terminals and
 * their labels). `herdr`, Homebrew's Herdr 1, is another program and never asked.
 *
 * An App is one space and a Ticket is one tab in it. The step keeps no state:
 * the terminal carries the Ticket Key and the App as labels in Herdr's core, so
 * reuse is a lookup and a closed terminal simply is not found. Herdr's app starts
 * the terminal rather than this process, so it has no parent to die with and
 * outlives the page and the daemon.
 */

const HERDR_APP = '/Applications/Herdr.app';
const TOOLS = ['hc', 'herdr-app'] as const;
const TOO_LONG_MS = 10_000;

const WindowSchema = z.object({
  spaces: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      machine: z.string().nullable(),
      tabs: z.array(z.object({ terminals: z.array(z.object({ terminal: z.string() })) })),
    }),
  ),
});
const LabelledSchema = z.object({ terminals: z.array(z.object({ address: z.string() })) });
const MadeSchema = z.object({ terminal: z.string() });
const RefusedSchema = z.object({ error: z.string() });

type Ran = { ok: true; out: string } | { ok: false; out: string; err: string };
type Env = Record<string, string | undefined>;

export interface HerdrOptions {
  env?: Env;
  /** Whether Herdr is here at all, which is what tells "not installed" from "tools not found". */
  appBundle?: string;
  timeoutMs?: number;
}

async function ran(path: string, args: string[], env: Env, timeoutMs: number): Promise<Ran> {
  const child = Bun.spawn([path, ...args], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', env, timeout: timeoutMs });
  const [out, err, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return exit === 0 ? { ok: true, out } : { ok: false, out, err: err.trim() };
}

function read<T>(out: string, schema: z.ZodType<T>): T | null {
  try {
    const result = schema.safeParse(JSON.parse(out));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** What a tool printed, held to the shape Herdr 2 prints, so another program of the same name is not taken for it. */
function parsed<T>(said: string, out: string, schema: z.ZodType<T>): T {
  const value = read(out, schema);
  if (value === null) throw new Error(`${said} answered in a shape this Goblin does not know: is it Herdr 2's?`);
  return value;
}

/**
 * On `PATH`, then where Herdr puts them. The LaunchAgent inherits no shell, so
 * the daemon's `PATH` is launchd's and `~/.local/bin` is never on it.
 */
function findTools(env: Env, appBundle: string): Record<(typeof TOOLS)[number], string> {
  const search = [env.PATH, env.HOME && join(env.HOME, '.local/bin')].filter(Boolean).join(':');
  const [hc, herdrApp] = TOOLS.map((tool) => Bun.which(tool, { PATH: search }));
  if (hc && herdrApp) return { hc, 'herdr-app': herdrApp };
  if (!hc && !herdrApp && !existsSync(appBundle)) throw new Error('Herdr is not installed, so no terminal was opened: install Herdr 2 and open it once');
  const absent = TOOLS.filter((_, i) => ![hc, herdrApp][i]);
  throw new Error(`Herdr is installed but ${absent.join(' and ')} ${absent.length > 1 ? 'were' : 'was'} not found on PATH or in ~/.local/bin: open Herdr once so it puts ${absent.length > 1 ? 'them' : 'it'} there`);
}

async function show(request: TerminalRequest, { env, appBundle, timeoutMs }: Required<HerdrOptions>) {
  const tools = findTools(env, appBundle);
  const hc = (...args: string[]) => ran(tools.hc, args, env, timeoutMs);

  const inWindow = await ran(tools['herdr-app'], ['ls'], env, timeoutMs);
  if (!inWindow.ok) throw new Error('Herdr is not open, so no terminal was opened: open the Herdr app and try again');
  const { spaces } = parsed('herdr-app ls', inWindow.out, WindowSchema);
  /** The window is the truth about what is shown: for a moment after a tab closes, the core still calls its terminal live. */
  const spaceShowing = new Map(spaces.flatMap((space) => space.tabs.flatMap((tab) => tab.terminals.map(({ terminal }) => [terminal, space.id] as const))));

  const carrying = async (label: string) => {
    const answer = await hc('ls', '--json', '--label', label);
    if (!answer.ok) throw new Error(`Herdr's core is not running, so no terminal was opened: run \`hc server start\` and try again${answer.err && ` (${answer.err})`}`);
    return parsed('hc ls', answer.out, LabelledSchema).terminals.map(({ address }) => address);
  };
  const windowDoes = async (command: string, args: Record<string, unknown>) => {
    const answer = await ran(tools['herdr-app'], ['do', command, JSON.stringify(args)], env, timeoutMs);
    if (answer.ok) return answer.out;
    throw new Error(`Herdr refused ${command}: ${read(answer.out, RefusedSchema)?.error ?? answer.err}`);
  };

  const live = (await carrying(`goblin.ticket=${request.ticket.key}`)).find((terminal) => spaceShowing.has(terminal));
  if (live) {
    await windowDoes('pane.focus', { terminal: live });
    return;
  }

  const appLabel = `goblin.app=${request.app.id}`;
  // the App's own terminals first, so a space or App renamed since still gets its Tickets
  const space = (await carrying(appLabel)).map((terminal) => spaceShowing.get(terminal)).find(Boolean) ?? spaces.find((s) => s.name === request.app.name && s.machine === null)?.id;
  const tab = `${request.ticket.key} ${request.ticket.title}`;
  const made = parsed(
    'herdr-app do',
    space ? await windowDoes('tab.new', { name: tab, space, folder: request.folder }) : await windowDoes('space.new', { name: request.app.name, folder: request.folder, tab }),
    MadeSchema,
  );

  const tagged = await hc('label', made.terminal, `goblin.ticket=${request.ticket.key}`, appLabel);
  if (!tagged.ok) throw new Error(`Herdr made terminal ${made.terminal} but it could not be tagged, so it will not be found again: ${tagged.err}`);
}

export function herdrTerminal({ env = process.env, appBundle = HERDR_APP, timeoutMs = TOO_LONG_MS }: HerdrOptions = {}): TerminalStep {
  return {
    open: async (request) => {
      try {
        await show(request, { env, appBundle, timeoutMs });
        return { opened: true };
      } catch (e) {
        return { opened: false, reason: e instanceof Error ? e.message : String(e), folder: request.folder };
      }
    },
  };
}
