import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { git } from './git';
import type { TerminalRequest, TerminalStep } from './terminal';

/**
 * Herdr 2, driven only through its two command-line tools: `herdr-app` is the
 * window (spaces, tabs, what is shown) and `hc` is its core (the terminals and
 * their labels). `herdr`, Homebrew's Herdr 1, is another program and never asked.
 *
 * A Ticket is a space of its own, its first terminal in the Worktree, so Herdr's
 * sidebar nests it under the App's space on the Checkout. The step keeps no state:
 * the terminal carries the Ticket Key, the Worktree folder and that the space is
 * the Ticket's as labels in Herdr's core, so reuse is a lookup and a closed
 * terminal simply is not found. A Ticket opened before, as a tab in its App's
 * space, lacks the last label, so that tab is never shown, closed or moved.
 * The folder is the one it was opened in, since the operator may have `cd`ed
 * away from it and a Ticket may have moved to another Worktree. Herdr's app starts
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
      folder: z.string(),
      machine: z.string().nullable(),
      tabs: z.array(z.object({ terminals: z.array(z.object({ terminal: z.string() })) })),
    }),
  ),
});
const LabelledSchema = z.object({ terminals: z.array(z.object({ address: z.string() })) });
/** `hc get`: its JSON `cwd` is where the terminal was launched, and the folder it is in now is its foreground program's. */
const TerminalSchema = z.object({ foreground: z.object({ cwd: z.string().nullish() }).nullish() });
const MadeSchema = z.object({ terminal: z.string() });
const RefusedSchema = z.object({ error: z.string() });
type Space = z.infer<typeof WindowSchema>['spaces'][number];

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

/** The working tree a folder is in, as git names it: real paths, as a terminal's live folder is. */
async function topLevel(folder: string) {
  const answer = await git(folder, ['rev-parse', '--show-toplevel']);
  return answer.ran && answer.ok ? answer.out : null;
}

/**
 * Herdr's sidebar nests a space whose first terminal is in a linked worktree
 * under a space on that repository's main working tree, and takes where a space
 * is from the live folder of its first terminal that has one, else the folder it
 * was made in (`mods/spaces/main.js`, `place()`). So that is what counts here,
 * whatever the space is called: one on this machine whose place git calls the
 * Checkout. Whether the App wants one made, then, is whether no space is there.
 */
async function wantsSpaceOn(checkout: string, spaces: Space[], liveFolder: (terminal: string) => Promise<string | null>) {
  const top = await topLevel(checkout);
  // nothing nests under a Checkout git cannot read, so a space made there would not help
  if (top === null) return false;
  for (const space of spaces.filter(({ machine }) => machine === null)) {
    let place = space.folder;
    for (const { terminal } of space.tabs.flatMap((tab) => tab.terminals)) {
      const live = await liveFolder(terminal);
      if (live) {
        place = live;
        break;
      }
    }
    // only a folder inside the Checkout can be on it; git then tells a linked worktree kept in there from the Checkout itself
    if ((place === top || place.startsWith(`${top}/`)) && (await topLevel(place)) === top) return false;
  }
  return true;
}

async function show(request: TerminalRequest, { env, appBundle, timeoutMs }: Required<HerdrOptions>) {
  const tools = findTools(env, appBundle);
  const hc = (...args: string[]) => ran(tools.hc, args, env, timeoutMs);

  const inWindow = await ran(tools['herdr-app'], ['ls'], env, timeoutMs);
  if (!inWindow.ok) throw new Error('Herdr is not open, so no terminal was opened: open the Herdr app and try again');
  const { spaces } = parsed('herdr-app ls', inWindow.out, WindowSchema);
  /** The window is the truth about what is shown: for a moment after a tab closes, the core still calls its terminal live. */
  const showing = new Set(spaces.flatMap((space) => space.tabs.flatMap((tab) => tab.terminals.map(({ terminal }) => terminal))));

  /** The live terminals carrying every one of these labels. */
  const carrying = async (...labels: string[]) => {
    const answer = await hc('ls', '--json', ...labels.flatMap((label) => ['--label', label]));
    if (!answer.ok) throw new Error(`Herdr's core is not running, so no terminal was opened: run \`hc server start\` and try again${answer.err && ` (${answer.err})`}`);
    return parsed('hc ls', answer.out, LabelledSchema).terminals;
  };
  /** Where a terminal is now; a terminal gone since the window was read is nowhere. */
  const liveFolder = async (terminal: string) => {
    const answer = await hc('get', terminal, '--json');
    return (answer.ok && read(answer.out, TerminalSchema)?.foreground?.cwd) || null;
  };
  const windowDoes = async (command: string, args: Record<string, unknown>) => {
    const answer = await ran(tools['herdr-app'], ['do', command, JSON.stringify(args)], env, timeoutMs);
    if (answer.ok) return answer.out;
    throw new Error(`Herdr refused ${command}: ${read(answer.out, RefusedSchema)?.error ?? answer.err}`);
  };

  // the Worktree as well, because a Ticket can leave a terminal in its old one, and two Tickets can share a folder;
  // and its own space, because a Ticket opened as a tab in its App's space is left as it is
  const ticketLabels = [`goblin.ticket=${request.ticket.key}`, `goblin.worktree=${request.folder}`, 'goblin.space=ticket'];
  const live = (await carrying(...ticketLabels)).find(({ address }) => showing.has(address));
  if (live) {
    await windowDoes('pane.focus', { terminal: live.address });
    return;
  }

  if (request.app.checkout && (await wantsSpaceOn(request.app.checkout, spaces, liveFolder))) await windowDoes('space.new', { name: request.app.name, folder: request.app.checkout });

  const made = parsed('herdr-app do', await windowDoes('space.new', { name: `${request.ticket.key} ${request.ticket.title}`, folder: request.folder }), MadeSchema);

  const tagged = await hc('label', made.terminal, ...ticketLabels);
  if (!tagged.ok) throw new Error(`Herdr made terminal ${made.terminal} but it could not be tagged, so it will not be found again: ${tagged.err}`);
}

/** Every way Herdr fails throws its sentence, which `openTerminal` reports as a terminal that did not open. */
export function herdrTerminal({ env = process.env, appBundle = HERDR_APP, timeoutMs = TOO_LONG_MS }: HerdrOptions = {}): TerminalStep {
  return {
    open: async (request) => {
      await show(request, { env, appBundle, timeoutMs });
      return { opened: true };
    },
  };
}
