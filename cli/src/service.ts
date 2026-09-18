/**
 * The tracker as a macOS LaunchAgent (ticket 13). Goblin has to be up whenever
 * I am working and I am mostly working in other repositories, so the one API
 * process is supervised by launchd rather than by a `bun dev` left running in
 * a terminal: `RunAtLoad` brings it up at login and `KeepAlive` brings it back
 * from any exit, including a `kill -9`.
 *
 * Like `backup`, this is not a client of the API — there is no endpoint that
 * could install a plist — so everything it does to the laptop goes through the
 * `Host` seam below and the tests hand it a fake one. Nothing here talks to a
 * real `launchctl` under test.
 *
 * Two decisions worth knowing before changing anything:
 *
 * - The plist pins `/opt/homebrew/bin/bun`, the stable symlink, and never the
 *   Cellar path a bun upgrade moves; and it pins this checkout, so a moved
 *   checkout is fixed by running `install` again.
 * - It carries no `EnvironmentVariables` at all. A LaunchAgent inherits no
 *   shell, so the server takes the default port and the default database — the
 *   one `goblin backup` reads — whatever this shell's `GF_DB_PATH` says. A
 *   different database means a server started by hand on another port.
 */
import { mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DEFAULT_PORT } from '@goblin/shared';
import { UsageError } from './args';

/** The agent's label, and so the name of its plist and its launchd service target. */
export const LABEL = 'dev.goblin-foundry';

/** The Homebrew symlink, which survives a bun upgrade; `/opt/homebrew/Cellar/bun/<version>/bin/bun` does not. */
export const BUN = '/opt/homebrew/bin/bun';

/** What the tracker answers on. The agent is given no `GF_PORT`, so this is the only port it is ever on. */
const TRACKER_URL = `http://127.0.0.1:${DEFAULT_PORT}/`;

/** What a program said and how it ended. */
export interface Ran {
  code: number;
  out: string;
  err: string;
}

/**
 * The laptop, as the one thing `service` is allowed to touch. Every member is
 * a side effect and nothing else is: the plist text, the status shape and the
 * log tail are all computed from these and from strings, which is what lets a
 * test run the whole noun without a launchd on the other side.
 */
export interface Host {
  /** `process.platform`. `service` is a macOS LaunchAgent and says so anywhere else. */
  platform: string;
  /** The login uid, which names the launchd domain (`gui/501`). */
  uid: number;
  home: string;
  /** This checkout: the directory the agent runs in and reads `api/src/server.ts` from. */
  checkout: string;
  /** Run a program to completion and collect what it said. */
  run(command: string[], cwd?: string): Promise<Ran>;
  /** The file's text, or `undefined` when there is no such file. */
  read(path: string): Promise<string | undefined>;
  /** Write it. The directory above it has to be there already — `mkdir` is the one thing that makes directories. */
  write(path: string, text: string): Promise<void>;
  remove(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  /** Whether anything answers there at all. */
  answers(url: string): Promise<boolean>;
  sleep(ms: number): Promise<void>;
}

const plistPath = (host: Host) => join(host.home, 'Library', 'LaunchAgents', `${LABEL}.plist`);
const logDir = (host: Host) => join(host.home, '.goblin-foundry', 'logs');
/** stdout first, stderr second — the order `logs` prints them in, and the order they are written into the plist. */
const logPaths = (host: Host): [out: string, err: string] => [join(logDir(host), 'service.out.log'), join(logDir(host), 'service.err.log')];
const serverPath = (host: Host) => join(host.checkout, 'api', 'src', 'server.ts');
/** Written out rather than taken from `defaultDbPath()`, which reads `GF_DB_PATH`: the agent has no environment, so it is always this one. */
const dbPath = (host: Host) => join(host.home, '.goblin-foundry', 'foundry.db');

// ── the plist ────────────────────────────────────────────────────────────────

// a macOS path may hold `&` or `<`, and a plist that is not well-formed XML is one launchd refuses without saying why
const escaped = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const unescaped = (text: string) => text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');

/** The agent, as launchd wants it. A pure function of the host's paths, so the test reads the real thing. */
export function plistFor(host: Host): string {
  const [out, err] = logPaths(host);
  const entry = (key: string, value: string) => [`  <key>${key}</key>`, `  ${value}`];
  const string = (value: string) => `<string>${escaped(value)}</string>`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    ...entry('Label', string(LABEL)),
    '  <key>ProgramArguments</key>',
    '  <array>',
    ...[BUN, serverPath(host)].map((argument) => `    ${string(argument)}`),
    '  </array>',
    ...entry('WorkingDirectory', string(host.checkout)),
    ...entry('RunAtLoad', '<true/>'),
    ...entry('KeepAlive', '<true/>'),
    ...entry('StandardOutPath', string(out)),
    ...entry('StandardErrorPath', string(err)),
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

/**
 * Which checkout the *installed* agent runs against, read back out of the
 * plist. It is not always this checkout — that is the whole point of reporting
 * it — so it is read rather than recomputed.
 */
const checkoutIn = (plist: string): string | null => {
  const found = /<key>WorkingDirectory<\/key>\s*<string>([^<]*)<\/string>/.exec(plist);
  return found ? unescaped(found[1] as string) : null;
};

// ── launchctl ────────────────────────────────────────────────────────────────

const launchctl = (host: Host, ...args: string[]) => host.run(['launchctl', ...args]);
const serviceTarget = (host: Host) => `gui/${host.uid}/${LABEL}`;

/**
 * What launchd holds: whether the job is in the domain at all, and the pid of
 * the process if one is up this instant. Named for launchd rather than for the
 * plist, because in this repository an `agent` is an AI (CONTEXT.md *Actor*).
 */
async function launchdJob(host: Host): Promise<{ loaded: boolean; pid: number | null }> {
  const listed = await launchctl(host, 'list', LABEL);
  if (listed.code !== 0) return { loaded: false, pid: null };
  const pid = /"PID"\s*=\s*(\d+)/.exec(listed.out)?.[1];
  return { loaded: true, pid: pid === undefined ? null : Number(pid) };
}

/** A tenth of a second, twenty looks to let go of a job, fifty to bind a port. */
const POLL_MS = 100;
const UNLOAD_LOOKS = 20;
const LISTENING_LOOKS = 50;

/** Look until it is true, or give up saying so. Nothing sleeps when it is true on the first look, which is every time the laptop had already caught up. */
async function until(host: Host, looks: number, settled: () => Promise<boolean>): Promise<boolean> {
  for (let look = 0; look < looks; look++) {
    if (await settled()) return true;
    await host.sleep(POLL_MS);
  }
  return false;
}

/** The line to quote from a `launchctl` that refused, which says what it could not do in one line and nothing else. */
const lastLine = (ran: Ran): string | undefined =>
  [ran.err, ran.out]
    .map((text) => text.trim().split('\n').at(-1)?.trim())
    .find((line) => line !== undefined && line !== '');

/**
 * Unload the agent for this login session, and do not return until it is
 * really out. `launchctl bootout` comes back while launchd is still taking the
 * job out of the domain, so a `status` straight after it reports the agent
 * loaded and a `bootstrap` straight after it is refused; a few short looks fix
 * both, and cost nothing when it has already gone.
 *
 * The refusal is read the same way: `bootout` on an agent that is not loaded
 * has reached the state it was asked for, so what counts is whether it is
 * still there afterwards, not what the command exited with.
 */
async function bootout(host: Host): Promise<void> {
  const ran = await launchctl(host, 'bootout', serviceTarget(host));
  const gone = await until(host, UNLOAD_LOOKS, async () => !(await launchdJob(host)).loaded);
  if (!gone) throw new Error(`launchctl could not unload ${LABEL}: ${lastLine(ran) ?? `bootout exited ${ran.code}`}`);
}

/** Load it, equally tolerantly: "already bootstrapped" is the state `start` wanted. */
async function bootstrap(host: Host): Promise<void> {
  const ran = await launchctl(host, 'bootstrap', `gui/${host.uid}`, plistPath(host));
  if (ran.code === 0) return;
  if ((await launchdJob(host)).loaded) return;
  throw new Error(`launchctl could not load ${plistPath(host)}: ${lastLine(ran) ?? `bootstrap exited ${ran.code}`}`);
}

/** Off, then on — and `bootout` has already waited for launchd to let go. */
async function reload(host: Host): Promise<void> {
  await bootout(host);
  await bootstrap(host);
  await waitForPort(host);
}

/**
 * launchd answers "the job is loaded" a moment before the server has bound its
 * port, and a report that said `listening: false` about a server that is
 * simply still starting would be worse than a short wait.
 */
const waitForPort = (host: Host) => until(host, LISTENING_LOOKS, () => host.answers(TRACKER_URL));

// ── what the verbs check first ───────────────────────────────────────────────

function macOnly(host: Host): void {
  if (host.platform !== 'darwin') throw new UsageError('`goblin service` installs a macOS LaunchAgent, and this is not macOS', 'run the server yourself: `bun api/src/server.ts`');
}

/** `start` and `restart` act on an agent that is already written; `install` is what writes one. */
async function requireInstalled(host: Host): Promise<void> {
  if ((await host.read(plistPath(host))) === undefined) throw new UsageError(`there is no agent at ${plistPath(host)}`, 'run `goblin service install` first');
}

/**
 * One thing can hold the port. If something already answers there and the job
 * is not loaded, it is a `bun dev` in this checkout — and bootstrapping on top
 * of it would leave launchd restarting a server that can never bind. It gates
 * `restart` for the same reason: a `restart` of an agent that is installed but
 * not loaded ends in a `bootstrap` like any other.
 */
async function requireFreePort(host: Host): Promise<void> {
  if (!(await host.answers(TRACKER_URL))) return;
  if ((await launchdJob(host)).loaded) return;
  throw new UsageError(`something already answers on ${TRACKER_URL}`, 'a `bun dev` in this checkout? stop it, or give it its own GF_PORT');
}

/**
 * The GUI the agent serves out of `web/dist`. A failure here is where
 * `install` and `restart` stop, with the running process untouched.
 *
 * The build's own output is not relayed. vite's reason arrives on stdout
 * behind bun's `@goblin/web build:` prefix while stderr carries only `error:
 * script "build" exited with code 1`, so no one line is the reason — and
 * putting the whole of it on stderr would mix prose into the one thing that
 * stream carries, which is problem+json. `bun run build` shows it in full.
 */
async function buildGui(host: Host): Promise<void> {
  const ran = await host.run([BUN, 'run', 'build'], host.checkout);
  if (ran.code === 0) return;
  throw new Error(`the GUI build failed and the service was left alone — run \`bun run build\` in ${host.checkout} to see why`);
}

// ── the verbs ────────────────────────────────────────────────────────────────

/** Every verb answers with this: what launchd holds, what the port says, and what the installed agent runs against. */
export async function serviceStatus(host: Host): Promise<{ text: string }> {
  macOnly(host);
  const { loaded, pid } = await launchdJob(host);
  const plist = await host.read(plistPath(host));
  return {
    text: JSON.stringify({
      loaded,
      listening: await host.answers(TRACKER_URL),
      checkout: plist === undefined ? null : checkoutIn(plist),
      db: dbPath(host),
      pid,
    }),
  };
}

export async function installService(host: Host): Promise<{ text: string }> {
  macOnly(host);
  if (!(await host.exists(BUN))) throw new UsageError(`there is no bun at ${BUN}`, 'the agent pins the Homebrew symlink so a bun upgrade cannot break it — install bun with brew, or change BUN in cli/src/service.ts');
  if (!(await host.exists(serverPath(host)))) throw new UsageError(`there is no server at ${serverPath(host)}`, 'the agent runs from the checkout `goblin` was linked from; `bun link` again from the one you moved to');
  await requireFreePort(host);

  await buildGui(host);
  // launchd creates neither the directory it is told to log into (it would refuse to spawn) nor, on a Mac that has never had an agent, the one agents live in
  for (const directory of [logDir(host), dirname(plistPath(host))]) await host.mkdir(directory);
  await host.write(plistPath(host), plistFor(host));
  await reload(host);
  return serviceStatus(host);
}

/**
 * The permanent off: the job leaves the domain and the plist leaves the disk.
 * The plist goes whatever launchd said, because that half is the half this
 * command owns — an agent left on disk after a failed `bootout` would come
 * back at the next login, which is the one thing "permanent" rules out. The
 * logs and the database are not the plist's to take.
 */
export async function uninstallService(host: Host): Promise<{ text: string }> {
  macOnly(host);
  try {
    await bootout(host);
  } finally {
    await host.remove(plistPath(host));
  }
  return serviceStatus(host);
}

export async function startService(host: Host): Promise<{ text: string }> {
  macOnly(host);
  await requireInstalled(host);
  await requireFreePort(host);
  await bootstrap(host);
  await waitForPort(host);
  return serviceStatus(host);
}

/**
 * Off until the next login — `RunAtLoad` brings it back then. `uninstall` is
 * the one that means it. Unlike `start` it does not ask for an installed
 * plist: `stop` names a state rather than an act, and on a laptop with no
 * agent that state already holds.
 */
export async function stopService(host: Host): Promise<{ text: string }> {
  macOnly(host);
  await bootout(host);
  return serviceStatus(host);
}

/** `install` minus the plist write, and so also how a change to Goblin itself reaches the running tracker. */
export async function restartService(host: Host): Promise<{ text: string }> {
  macOnly(host);
  await requireInstalled(host);
  await requireFreePort(host);
  await buildGui(host);
  await reload(host);
  return serviceStatus(host);
}

/** The end of both log files. Prose, like `design get` is markdown — there is no JSON shape for a stack trace. */
export async function serviceLogs(host: Host, lines: number): Promise<{ text: string }> {
  macOnly(host);
  const blocks = await Promise.all(
    logPaths(host).map(async (path) => {
      // a log file ends in a newline, which is the end of its last line rather than a line of its own
      const written = (await host.read(path))?.replace(/\n$/, '').split('\n') ?? [];
      const tail = written.length === 0 || written[0] === '' ? '(nothing logged yet)' : written.slice(-lines).join('\n');
      return `==> ${path} <==\n${tail}`;
    }),
  );
  return { text: blocks.join('\n\n') };
}

// ── the real laptop ──────────────────────────────────────────────────────────

/**
 * The one `goblin` runs against. `checkout` is resolved from this file rather
 * than from `process.cwd()`, because `service` is nearly always run from
 * another repository — that is the reason the ticket exists — and what the
 * agent must pin is the checkout this `goblin` was linked from.
 */
export const DEFAULT_HOST: Host = {
  platform: process.platform,
  uid: process.getuid?.() ?? 0,
  home: homedir(),
  checkout: resolve(import.meta.dir, '..', '..'),
  async run(command, cwd) {
    const child = Bun.spawn(command, { cwd, stdout: 'pipe', stderr: 'pipe' });
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { code, out, err };
  },
  read: async (path) => {
    const file = Bun.file(path);
    return (await file.exists()) ? file.text() : undefined;
  },
  write: async (path, text) => void (await Bun.write(path, text)),
  remove: async (path) => rmSync(path, { force: true }),
  exists: (path) => Bun.file(path).exists(),
  mkdir: async (path) => void mkdirSync(path, { recursive: true }),
  answers: async (url) => {
    try {
      // any answer at all means the port is taken; a 404 would do
      await fetch(url, { signal: AbortSignal.timeout(1000) });
      return true;
    } catch {
      return false;
    }
  },
  sleep: (ms) => Bun.sleep(ms),
};
