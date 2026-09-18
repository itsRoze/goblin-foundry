/**
 * `goblin service` against a fake laptop. The noun is not a client of the API
 * (like `backup`), so what it does instead — shell out to `launchctl`, build
 * the GUI, write a plist, look at a port — arrives through the `Host` seam,
 * and every one of those is faked here. Nothing in this file loads a real
 * agent, writes a real plist, or runs a real build.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { runGoblin, type GoblinResult } from '../src/run';
import { BUN, LABEL, type Host, type Ran } from '../src/service';

const HOME = '/Users/tester';
const CHECKOUT = '/Users/tester/dev/goblin-foundry';
const PLIST = `${HOME}/Library/LaunchAgents/${LABEL}.plist`;
const SERVER = `${CHECKOUT}/api/src/server.ts`;
const LOGS = `${HOME}/.goblin-foundry/logs`;
const DB = `${HOME}/.goblin-foundry/foundry.db`;

interface FakeOptions {
  platform?: string;
  /** Whether the agent is loaded when the command starts. */
  loaded?: boolean;
  /** Whether the port answers; by default it answers exactly when the agent is loaded. */
  answers?: boolean;
  /** What `bun run build` exits with. */
  build?: Ran;
  files?: Record<string, string>;
  /** Paths that are *not* on this laptop, for the refusals about a missing bun or a moved checkout. */
  absent?: string[];
  /** How many looks after a `bootout` launchd still reports the job, which is how the real one behaves. */
  lingers?: number;
}

/** A laptop in a variable: an in-memory filesystem, a scripted `launchctl`, and a log of every command asked of it. */
function fake(options: FakeOptions = {}) {
  const files = new Map(Object.entries(options.files ?? {}));
  const dirs: string[] = [];
  const commands: string[][] = [];
  let loaded = options.loaded ?? false;

  let lingering = 0;

  const launchctl = (command: string[]): Ran => {
    if (command[1] === 'list') {
      // launchd keeps answering for a job it is still tearing down
      if (lingering > 0) {
        lingering--;
        return { code: 0, out: `{\n\t"Label" = "${LABEL}";\n}`, err: '' };
      }
      return loaded ? { code: 0, out: `{\n\t"Label" = "${LABEL}";\n\t"PID" = 4242;\n}`, err: '' } : { code: 113, out: '', err: `Could not find service "${LABEL}"` };
    }
    if (command[1] === 'bootout') {
      if (!loaded) return { code: 3, out: '', err: 'Boot-out failed: 3: No such process' };
      loaded = false;
      lingering = options.lingers ?? 0;
      return { code: 0, out: '', err: '' };
    }
    // launchd is handed the plist to bootstrap from, and refuses one that is not there
    if (!files.has(String(command[3]))) return { code: 5, out: '', err: 'Bootstrap failed: 5: Input/output error' };
    loaded = true;
    return { code: 0, out: '', err: '' };
  };

  const host: Host = {
    platform: options.platform ?? 'darwin',
    uid: 501,
    home: HOME,
    checkout: CHECKOUT,
    async run(command) {
      commands.push(command);
      if (command[0] === 'launchctl') return launchctl(command);
      if (command[0] === BUN) return options.build ?? { code: 0, out: 'vite v7 built in 400ms\n', err: '' };
      throw new Error(`nothing faked for ${command.join(' ')}`);
    },
    read: async (path) => files.get(path),
    write: async (path, text) => void files.set(path, text),
    remove: async (path) => void files.delete(path),
    exists: async (path) => !(options.absent ?? []).includes(path) && (path === BUN || path === SERVER || files.has(path)),
    mkdir: async (path) => void dirs.push(path),
    answers: async () => options.answers ?? loaded,
    sleep: async () => {},
  };

  return {
    host,
    files,
    dirs,
    commands,
    isLoaded: () => loaded,
    /** What was *done*, in order, as a readable script. `launchctl list` is left out: it is a look, not an act, and the verbs take several. */
    script: () => commands.filter((c) => c[1] !== 'list').map((c) => (c[0] === BUN ? 'build' : `launchctl ${c[1]}`)),
    launchctlVerbs: () => commands.filter((c) => c[0] === 'launchctl').map((c) => c[1] as string),
  };
}

type Laptop = ReturnType<typeof fake>;

/** The service noun never reaches the API, so a `fetch` that answers at all would be a bug. */
const run = (argv: string[], laptop: Laptop): Promise<GoblinResult> => runGoblin(argv, { fetch: () => Promise.reject(new Error('`service` is not a client of the API')), env: {}, host: laptop.host });

const json = async (argv: string[], laptop: Laptop) => {
  const result = await run(argv, laptop);
  expect([argv.join(' '), result.code, result.err]).toEqual([argv.join(' '), 0, '']);
  return JSON.parse(result.out);
};

const problemOf = (result: GoblinResult) => {
  expect(result.out).toBe('');
  return JSON.parse(result.err) as { title: string; detail: string; hint?: string };
};

const plistWith = (checkout: string) => `<plist><dict><key>WorkingDirectory</key>\n  <string>${checkout}</string></dict></plist>`;
/** A laptop with the agent already installed and running, which is what most verbs act on. */
const installed = (over: FakeOptions = {}) => fake({ loaded: true, files: { [PLIST]: plistWith(CHECKOUT) }, ...over });

describe('goblin service', () => {
  describe('install', () => {
    test('builds the GUI, writes the agent, and loads it — in that order', async () => {
      const laptop = fake();
      const status = await json(['service', 'install'], laptop);

      // the build runs first: a plist is only worth writing for a GUI that exists
      expect(laptop.script()).toEqual(['build', 'launchctl bootout', 'launchctl bootstrap']);
      expect(laptop.commands[0]).toEqual([BUN, 'run', 'build']);
      expect(status).toMatchObject({ loaded: true, listening: true, checkout: CHECKOUT, pid: 4242 });
    });

    test('the plist pins the Homebrew symlink, this checkout, and the two log files', async () => {
      const laptop = fake();
      await json(['service', 'install'], laptop);
      const plist = laptop.files.get(PLIST) as string;

      expect(plist).toContain(`<string>${BUN}</string>`);
      // never the Cellar path: a bun upgrade moves that one and would leave the agent pointing at nothing
      expect(plist).not.toContain('Cellar');
      expect(plist).toContain(`<string>${SERVER}</string>`);
      expect(plist).toContain(`<key>WorkingDirectory</key>\n  <string>${CHECKOUT}</string>`);
      expect(plist).toContain(`<key>Label</key>\n  <string>${LABEL}</string>`);
      expect(plist).toContain('<key>RunAtLoad</key>\n  <true/>');
      expect(plist).toContain('<key>KeepAlive</key>\n  <true/>');
      expect(plist).toContain(`<key>StandardOutPath</key>\n  <string>${LOGS}/service.out.log</string>`);
      expect(plist).toContain(`<key>StandardErrorPath</key>\n  <string>${LOGS}/service.err.log</string>`);
      // no EnvironmentVariables at all: a LaunchAgent inherits no shell, so the server takes the default database and port
      expect(plist).not.toContain('EnvironmentVariables');
      // launchd will not create the directory it is told to log into, so install does
      expect(laptop.dirs).toContain(LOGS);
    });

    test('running it twice is harmless: the plist is rewritten and the agent reloaded', async () => {
      const laptop = installed();
      expect(await json(['service', 'install'], laptop)).toMatchObject({ loaded: true, listening: true });
      expect(laptop.files.get(PLIST)).toContain(SERVER);
      expect(laptop.launchctlVerbs()).toContain('bootout');
    });

    test('a bun that is not at the pinned path, and a checkout without a server in it, are refused before anything is built', async () => {
      const missingBun = fake({ absent: [BUN] });
      const refused = await run(['service', 'install'], missingBun);
      expect(refused.code).toBe(2);
      expect(problemOf(refused).detail).toContain(BUN);
      expect(missingBun.commands).toEqual([]);

      const moved = fake({ absent: [SERVER] });
      const gone = await run(['service', 'install'], moved);
      expect(gone.code).toBe(2);
      expect(problemOf(gone).detail).toContain(SERVER);
      expect(moved.commands).toEqual([]);
    });

    test('something else already on the port is a refusal that names `bun dev` and GF_PORT', async () => {
      const busy = fake({ answers: true, loaded: false });
      const refused = await run(['service', 'install'], busy);
      expect(refused.code).toBe(2);
      const problem = problemOf(refused);
      expect(problem.detail).toContain('4747');
      expect(problem.hint).toContain('bun dev');
      expect(problem.hint).toContain('GF_PORT');
      expect(busy.commands.some((c) => c[0] === BUN)).toBe(false);
    });

    test('a failed build leaves the plist and the running process as they were', async () => {
      const laptop = installed({ build: { code: 1, out: '', err: 'no space left on device\n' } });
      expect((await run(['service', 'install'], laptop)).code).toBe(1);
      expect(laptop.files.get(PLIST)).toBe(plistWith(CHECKOUT));
      expect(laptop.isLoaded()).toBe(true);
    });
  });

  describe('status', () => {
    test('is `{loaded, listening, checkout, db, pid}`, and exit 0 when nothing is installed', async () => {
      const result = await run(['service', 'status'], fake());
      expect(result.code).toBe(0);
      expect(JSON.parse(result.out)).toEqual({ loaded: false, listening: false, checkout: null, db: DB, pid: null });
    });

    test('reads the pid from launchctl and the checkout from the installed plist', async () => {
      const elsewhere = '/Users/tester/elsewhere/goblin-foundry';
      expect(await json(['service', 'status'], fake({ loaded: true, files: { [PLIST]: plistWith(elsewhere) } }))).toEqual({
        loaded: true,
        listening: true,
        // what the agent runs against, which is not always the checkout this `goblin` was linked from
        checkout: elsewhere,
        db: DB,
        pid: 4242,
      });
    });

    test('a loaded agent whose process is between restarts has no pid', async () => {
      const laptop = installed();
      laptop.host.run = async (command) => (command[1] === 'list' ? { code: 0, out: `{\n\t"Label" = "${LABEL}";\n}`, err: '' } : { code: 0, out: '', err: '' });
      expect(await json(['service', 'status'], laptop)).toMatchObject({ loaded: true, pid: null });
    });

    describe('the database', () => {
      const saved = process.env.GF_DB_PATH;
      afterEach(() => {
        if (saved === undefined) delete process.env.GF_DB_PATH;
        else process.env.GF_DB_PATH = saved;
      });

      test('is the default one whatever this shell says, because a LaunchAgent carries no environment', async () => {
        process.env.GF_DB_PATH = '/tmp/some-other.db';
        expect((await json(['service', 'status'], installed())).db).toBe(DB);
      });
    });
  });

  describe('start, stop, restart, uninstall', () => {
    test('stop unloads and leaves the plist; the agent is back at the next login', async () => {
      const laptop = installed();
      expect(await json(['service', 'stop'], laptop)).toMatchObject({ loaded: false, listening: false });
      expect(laptop.files.has(PLIST)).toBe(true);
      expect(laptop.launchctlVerbs()).toContain('bootout');
    });

    /** `launchctl bootout` returns while launchd is still taking the job out of the domain; a report made in that moment said `loaded: true` about an agent that had just been stopped. */
    test('stop waits for launchd to let go before it says anything', async () => {
      expect(await json(['service', 'stop'], installed({ lingers: 3 }))).toMatchObject({ loaded: false, pid: null });
    });

    test('uninstall unloads, removes the plist, and touches nothing else', async () => {
      const laptop = installed({ files: { [PLIST]: plistWith(CHECKOUT), [`${LOGS}/service.out.log`]: 'a log nobody asked to lose' } });
      expect(await json(['service', 'uninstall'], laptop)).toMatchObject({ loaded: false, checkout: null });
      expect(laptop.files.has(PLIST)).toBe(false);
      expect(laptop.files.get(`${LOGS}/service.out.log`)).toBe('a log nobody asked to lose');
    });

    /** The half `uninstall` owns is the plist: an agent left on disk after a failed `bootout` would come back at the next login, which is what "permanent" rules out. */
    test('uninstall takes the plist even when launchctl refuses to unload, and still reports the failure', async () => {
      const stuck = installed();
      stuck.host.run = async (command) => (command[1] === 'bootout' ? { code: 3, out: '', err: 'Boot-out failed: 3: No such process' } : { code: 0, out: `{\n\t"Label" = "${LABEL}";\n\t"PID" = 4242;\n}`, err: '' });

      const failed = await run(['service', 'uninstall'], stuck);
      expect(failed.code).toBe(1);
      expect(problemOf(failed).detail).toContain('could not unload');
      expect(stuck.files.has(PLIST)).toBe(false);
    });

    test('start loads the installed agent, and refuses when there is none', async () => {
      const laptop = installed({ loaded: false });
      expect(await json(['service', 'start'], laptop)).toMatchObject({ loaded: true, listening: true });
      // starting is not building: only `install` and `restart` touch `web/dist`
      expect(laptop.commands.some((c) => c[0] === BUN)).toBe(false);

      const bare = await run(['service', 'start'], fake());
      expect(bare.code).toBe(2);
      expect(problemOf(bare).hint).toContain('goblin service install');
    });

    test('restart rebuilds the GUI, then bounces the process, and never rewrites the plist', async () => {
      const laptop = installed();
      expect(await json(['service', 'restart'], laptop)).toMatchObject({ loaded: true, listening: true });
      expect(laptop.script()).toEqual(['build', 'launchctl bootout', 'launchctl bootstrap']);
      expect(laptop.files.get(PLIST)).toBe(plistWith(CHECKOUT));
    });

    test('a failed build aborts the restart and leaves the running process alone', async () => {
      const laptop = installed({ build: { code: 1, out: '@goblin/web build: error during build:\n', err: 'error: script "build" exited with code 1\n' } });
      const failed = await run(['service', 'restart'], laptop);

      expect(failed.code).toBe(1);
      // the build's own output is not relayed (stderr carries problem+json and nothing else), so the refusal says where to see it
      expect(problemOf(failed).detail).toBe(`the GUI build failed and the service was left alone — run \`bun run build\` in ${CHECKOUT} to see why`);
      // nothing was unloaded: the tracker that was up is still up
      expect(laptop.script()).toEqual(['build']);
      expect(laptop.isLoaded()).toBe(true);
    });
  });

  describe('logs', () => {
    const files = {
      [PLIST]: plistWith(CHECKOUT),
      [`${LOGS}/service.out.log`]: 'one\ntwo\nthree\nfour\n',
      [`${LOGS}/service.err.log`]: 'a stack trace\n',
    };

    test('tails both files, newest lines last, and says which file each block is', async () => {
      const result = await run(['service', 'logs'], fake({ files }));
      expect(result.code).toBe(0);
      expect(result.out).toContain(`${LOGS}/service.out.log`);
      expect(result.out).toContain(`${LOGS}/service.err.log`);
      expect(result.out).toContain('four');
      expect(result.out).toContain('a stack trace');
      expect(result.out.indexOf('service.out.log')).toBeLessThan(result.out.indexOf('service.err.log'));
    });

    test('--lines takes the last n of each, and a file nobody has written yet is said so rather than failing', async () => {
      const some = await run(['service', 'logs', '--lines', '2'], fake({ files }));
      expect(some.out).toContain('three\nfour');
      expect(some.out).not.toContain('two');

      const nothing = await run(['service', 'logs'], fake());
      expect(nothing.code).toBe(0);
      expect(nothing.out).toContain('nothing logged yet');

      const bad = await run(['service', 'logs', '--lines', 'lots'], fake());
      expect(bad.code).toBe(2);
      expect(problemOf(bad).detail).toContain('--lines');
    });
  });

  test('every verb refuses on a laptop that is not a Mac, and says what to run instead', async () => {
    for (const verb of ['install', 'uninstall', 'start', 'stop', 'restart', 'status', 'logs']) {
      const laptop = fake({ platform: 'linux' });
      const result = await run(['service', verb], laptop);
      expect([verb, result.code]).toEqual([verb, 2]);
      const problem = problemOf(result);
      expect([verb, problem.detail]).toEqual([verb, expect.stringContaining('macOS')]);
      expect([verb, problem.hint]).toEqual([verb, expect.stringContaining('server.ts')]);
      expect([verb, laptop.commands]).toEqual([verb, []]);
    }
  });

  test('`goblin service` on its own lists its verbs rather than guessing at one', async () => {
    const bare = await run(['service'], fake());
    expect(bare.code).toBe(2);
    expect(problemOf(bare).hint).toContain('goblin service --help');

    const help = await run(['service', '--help'], fake());
    expect(help.code).toBe(0);
    for (const verb of ['install', 'uninstall', 'start', 'stop', 'restart', 'status', 'logs']) expect(help.out).toContain(`\n  ${verb} `);
  });
});
