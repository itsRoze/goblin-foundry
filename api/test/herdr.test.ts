import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { herdrTerminal } from '../src/herdr';
import type { TerminalRequest } from '../src/terminal';
import { makeTestApp } from './harness';

/** What a stand-in answers; `turns` answers each in order, one per call, and then the last again. */
type Answer = { out?: unknown; turns?: unknown[]; raw?: string; err?: string; code?: number; hang?: boolean };
type Space = { id: string; name: string; folder?: string; machine?: string | null; terminals?: string[] };
/** A terminal in Herdr's core: the folder it was launched in, and the one its shell or program is in now. */
type CoreTerminal = { address: string; launched?: string; live?: string | null; labels?: Record<string, string> };

/** `herdr-app ls`: spaces > tabs > terminals, in the shape the real one printed, a tab per terminal. */
const windowWith = (...spaces: Space[]) => ({
  out: {
    spaces: spaces.map((s) => ({
      id: s.id,
      name: s.name,
      folder: s.folder ?? '/somewhere',
      machine: s.machine ?? null,
      active: false,
      tabs: (s.terminals ?? []).map((terminal, i) => ({ id: `tab-${terminal}`, name: String(i + 1), active: i === 0, settled: false, terminals: [{ terminal, pane: `pane-${terminal}`, status: null, app: null, name: null, sub_agents: [] }] })),
    })),
    recent: [],
  },
});

const gitIn = (cwd: string, ...args: string[]) => expect(Bun.spawnSync(['git', '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd }).exitCode).toBe(0);

describe('the Herdr terminal step, against stand-ins on a temporary PATH', () => {
  let scratch: string;
  let bin: string;
  let home: string;
  let log: string;
  let core: string;
  let installed: string;
  let missing: string;
  /** A real repository and a linked worktree of it, since what nests a space is git's answer about its folder. */
  let checkout: string;
  let worktree: string;
  let subway: TerminalRequest;

  beforeEach(() => {
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'gf-herdr-')));
    bin = join(scratch, 'bin');
    home = join(scratch, 'home');
    log = join(scratch, 'calls');
    core = join(scratch, 'core.json');
    installed = join(scratch, 'Herdr.app');
    missing = join(scratch, 'Nothing.app');
    checkout = join(scratch, 'subway-reader');
    worktree = join(scratch, 'worktrees', 'subway-reader', 'gf-12');
    mkdirSync(bin);
    mkdirSync(home);
    mkdirSync(installed);
    mkdirSync(checkout);
    writeFileSync(log, '');
    gitIn(checkout, 'init', '-q', '-b', 'main');
    gitIn(checkout, 'commit', '-q', '--allow-empty', '-m', 'first');
    gitIn(checkout, 'worktree', 'add', '-q', '-b', 'gf-12', worktree);
    subway = { app: { name: 'Subway Reader', checkout }, ticket: { key: 'GF-12', title: 'Parse the feed' }, folder: worktree };
  });
  afterEach(() => rmSync(scratch, { recursive: true, force: true }));

  /** The App's space, on the Checkout: its one terminal is t1, live there. */
  const appSpace = (): [Space, CoreTerminal] => [{ id: 'sp-subway', name: 'Subway Reader', terminals: ['t1'] }, { address: 't1', live: checkout }];
  /** A terminal the step made for GF-12, in its own space. */
  const ticketTerminal = (address: string, folder = worktree): CoreTerminal => ({ address, live: folder, labels: { 'goblin.ticket': 'GF-12', 'goblin.worktree': folder, 'goblin.space': 'ticket' } });

  /**
   * A stand-in executable: writes its arguments down, then plays back the answer
   * for the first pattern (a shell glob over the arguments) that matches. A call
   * nothing was canned for exits 99, so an unexpected command fails the test.
   */
  const standIn = (name: string, answers: Record<string, Answer>, dir = bin) => {
    mkdirSync(dir, { recursive: true });
    const cases = Object.entries(answers).map(([pattern, answer], i) => {
      const out = join(dir, `.${name}-${i}.out`);
      const err = join(dir, `.${name}-${i}.err`);
      writeFileSync(out, answer.raw ?? (answer.out === undefined ? '' : JSON.stringify(answer.out)));
      writeFileSync(err, answer.err ?? '');
      const turns = (answer.turns ?? []).map((turn, n) => {
        writeFileSync(`${out}.${n}`, JSON.stringify(turn));
        return `${out}.${n}`;
      });
      const counted = join(dir, `.${name}-${i}.count`);
      if (turns.length) writeFileSync(counted, '');
      const said = turns.length ? `n=$(/usr/bin/wc -l < '${counted}' | /usr/bin/tr -d ' '); echo >> '${counted}'; [ "$n" -lt ${turns.length} ] || n=${turns.length - 1}; /bin/cat '${out}.'"$n"` : `/bin/cat '${out}'`;
      const body = answer.hang ? 'exec /bin/sleep 30' : `${said}; /bin/cat '${err}' >&2; exit ${answer.code ?? 0}`;
      return `  ${pattern.replaceAll(' ', '\\ ')}) ${body} ;;`;
    });
    const script = [
      '#!/bin/sh',
      `{ printf '%s' '${name}'; for a in "$@"; do printf '\\t%s' "$a"; done; printf '\\n'; } >> '${log}'`,
      'case "$*" in',
      ...cases,
      '  *) exit 99 ;;',
      'esac',
      '',
    ].join('\n');
    const path = join(dir, name);
    writeFileSync(path, script);
    chmodSync(path, 0o755);
  };

  /** Herdr's core: these terminals, answering as the real `hc` does. A live folder not given is where it was launched. */
  const coreWith = (terminals: CoreTerminal[], fail: Record<string, { code: number; err: string }> = {}, dir = bin) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(core, JSON.stringify({ terminals: terminals.map((t) => ({ launched: '/somewhere', labels: {}, ...t, live: t.live === undefined ? (t.launched ?? '/somewhere') : t.live })), fail }));
    const path = join(dir, 'hc');
    writeFileSync(path, `#!/bin/sh\nexec '${process.execPath}' '${join(import.meta.dir, 'fake-hc.ts')}' '${core}' '${log}' "$@"\n`);
    chmodSync(path, 0o755);
  };

  /** Every call, in order, one array of arguments each. */
  const calls = () =>
    readFileSync(log, 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => line.split('\t'));

  /** Each `herdr-app do <command>`, with its one JSON object read back. */
  const done = () => calls().filter((c) => c[0] === 'herdr-app' && c[1] === 'do').map((c) => ({ [c[2]!]: JSON.parse(c[3]!) }));
  const labels = () => calls().find((c) => c[0] === 'hc' && c[1] === 'label')?.slice(2);

  const step = (over: Partial<Parameters<typeof herdrTerminal>[0]> = {}) => herdrTerminal({ env: { PATH: bin, HOME: home }, appBundle: installed, ...over });

  /** A Herdr with a window and a core. The spaces it makes hold t9, then t10. */
  const herdr = (window: Answer, terminals: CoreTerminal[] = [], over: Record<string, Answer> = {}, coreFails: Record<string, { code: number; err: string }> = {}) => {
    standIn('herdr-app', {
      ls: window,
      'do space.new*': { turns: ['t9', 't10'].map((terminal) => ({ space: `sp-${terminal}`, tab: `tb-${terminal}`, terminal })) },
      'do pane.focus*': { out: { ok: true } },
      ...over,
    });
    coreWith(terminals, coreFails);
  };

  describe('first open', () => {
    test("with the App's space on its Checkout, makes the Ticket a space of its own, named by Ticket Key and title, in the Worktree", async () => {
      herdr(windowWith(appSpace()[0]), [appSpace()[1]]);
      expect(await step().open(subway)).toEqual({ opened: true });
      expect(done()).toEqual([{ 'space.new': { name: 'GF-12 Parse the feed', folder: worktree } }]);
    });

    test('with no space on the Checkout, first makes one there named after the App, a plain shell in it, then the Ticket\'s', async () => {
      herdr(windowWith({ id: 'sp-other', name: 'Another App', terminals: ['t1'] }), [{ address: 't1', live: scratch }]);
      expect(await step().open(subway)).toEqual({ opened: true });
      expect(done()).toEqual([{ 'space.new': { name: 'Subway Reader', folder: checkout } }, { 'space.new': { name: 'GF-12 Parse the feed', folder: worktree } }]);
    });

    test('tags the terminal it made with the Ticket Key, the Worktree folder and that the space is the Ticket\'s', async () => {
      herdr(windowWith(appSpace()[0]), [appSpace()[1]]);
      await step().open(subway);
      expect(labels()).toEqual(['t9', 'goblin.ticket=GF-12', `goblin.worktree=${worktree}`, 'goblin.space=ticket']);
    });

    test('runs no program: the terminal is whatever shell Herdr starts', async () => {
      herdr(windowWith());
      await step().open(subway);
      expect(done().map((command) => Object.values(command)[0].argv)).toEqual([undefined, undefined]);
    });

    test('a title that looks like JSON or a flag arrives as the name, untouched', async () => {
      herdr(windowWith(appSpace()[0]), [appSpace()[1]]);
      await step().open({ ...subway, ticket: { key: 'GF-12', title: '--confirmed "true" {"a":1}' } });
      expect(done()).toEqual([{ 'space.new': { name: 'GF-12 --confirmed "true" {"a":1}', folder: worktree } }]);
    });
  });

  describe('opening again', () => {
    test("the Ticket's live terminal is shown, and nothing is made", async () => {
      herdr(windowWith(appSpace()[0], { id: 'sp-12', name: 'GF-12 Parse the feed', terminals: ['t4'] }), [appSpace()[1], ticketTerminal('t4')]);
      expect(await step().open(subway)).toEqual({ opened: true });
      expect(done()).toEqual([{ 'pane.focus': { terminal: 't4' } }]);
      expect(labels()).toBeUndefined();
    });

    test('a tab the Ticket was opened in before it had a space of its own is left alone, and its space is made', async () => {
      const oldStyle: CoreTerminal = { address: 't4', live: worktree, labels: { 'goblin.ticket': 'GF-12', 'goblin.app': '7', 'goblin.worktree': worktree } };
      herdr(windowWith({ ...appSpace()[0], terminals: ['t1', 't4'] }), [appSpace()[1], oldStyle]);
      expect(await step().open(subway)).toEqual({ opened: true });
      expect(done()).toEqual([{ 'space.new': { name: 'GF-12 Parse the feed', folder: worktree } }]);
      expect(labels()?.[0]).toBe('t9');
    });

    test("the Ticket's terminal in its old Worktree is left alone, and a fresh space opens in the recorded folder", async () => {
      herdr(windowWith(appSpace()[0], { id: 'sp-12', name: 'GF-12 Parse the feed', terminals: ['t4'] }), [appSpace()[1], ticketTerminal('t4', `${worktree}-old`)]);
      expect(await step().open(subway)).toEqual({ opened: true });
      expect(done()).toEqual([{ 'space.new': { name: 'GF-12 Parse the feed', folder: worktree } }]);
    });

    test('another Ticket sharing the Worktree folder does not take its terminal', async () => {
      herdr(windowWith(appSpace()[0], { id: 'sp-13', name: 'GF-13 Other', terminals: ['t4'] }), [appSpace()[1], { ...ticketTerminal('t4'), labels: { ...ticketTerminal('t4').labels, 'goblin.ticket': 'GF-13' } }]);
      await step().open(subway);
      expect(done()).toEqual([{ 'space.new': { name: 'GF-12 Parse the feed', folder: worktree } }]);
    });

    test('a terminal the core still calls live but the window no longer shows counts as closed', async () => {
      // what `hc ls` says for a moment after a space is closed
      herdr(windowWith(appSpace()[0]), [appSpace()[1], ticketTerminal('t4')]);
      await step().open(subway);
      expect(done()).toEqual([{ 'space.new': { name: 'GF-12 Parse the feed', folder: worktree } }]);
    });
  });

  describe("which space is the App's: one Herdr nests the Ticket's under", () => {
    /** Whether the step made the App a space on its Checkout before the Ticket's, in a Herdr showing these spaces. */
    const appSpaceMade = async ([spaces, terminals]: [Space[], CoreTerminal[]]) => {
      herdr(windowWith(...spaces), terminals);
      await step().open(subway);
      const made = done();
      expect(made.at(-1)).toEqual({ 'space.new': { name: 'GF-12 Parse the feed', folder: worktree } });
      if (made.length === 1) return false;
      expect(made).toEqual([{ 'space.new': { name: 'Subway Reader', folder: checkout } }, made.at(-1)!]);
      return true;
    };

    test("a space named after the App whose terminal is somewhere else is not the App's", async () => {
      expect(await appSpaceMade([[{ id: 'sp-home', name: 'Subway Reader', folder: home, terminals: ['t1'] }], [{ address: 't1', live: home }]])).toBe(true);
    });

    test("a space whose first terminal has moved into the Checkout is the App's, whatever it is called or was made in", async () => {
      expect(await appSpaceMade([[{ id: 'sp-x', name: 'Something else', folder: home, terminals: ['t1', 't2'] }], [{ address: 't1', launched: home, live: checkout }, { address: 't2', live: home }]])).toBe(false);
    });

    test("a space made on the Checkout whose first terminal has moved away is not the App's", async () => {
      expect(await appSpaceMade([[{ id: 'sp-x', name: 'Subway Reader', folder: checkout, terminals: ['t1'] }], [{ address: 't1', launched: checkout, live: home }]])).toBe(true);
    });

    test('its first terminal decides, not a later one', async () => {
      expect(await appSpaceMade([[{ id: 'sp-x', name: 'Subway Reader', folder: checkout, terminals: ['t1', 't2'] }], [{ address: 't1', live: home }, { address: 't2', live: checkout }]])).toBe(true);
    });

    test('a space made on the Checkout whose terminal has no live folder yet is on the Checkout', async () => {
      expect(await appSpaceMade([[{ id: 'sp-x', name: 'Subway Reader', folder: checkout, terminals: ['t1'] }], [{ address: 't1', live: null }]])).toBe(false);
    });

    test('a folder inside the Checkout is on it', async () => {
      mkdirSync(join(checkout, 'src'));
      expect(await appSpaceMade([[{ id: 'sp-x', name: 'x', terminals: ['t1'] }], [{ address: 't1', live: join(checkout, 'src') }]])).toBe(false);
    });

    test("another Ticket's space, in a linked worktree, is not the App's, even one kept inside the Checkout's folder", async () => {
      const inside = join(checkout, '.worktrees', 'gf-11');
      gitIn(checkout, 'worktree', 'add', '-q', '-b', 'gf-11', inside);
      expect(await appSpaceMade([[{ id: 'sp-11', name: 'GF-11 Other', terminals: ['t1'] }], [{ address: 't1', live: inside }]])).toBe(true);
    });

    test('a space on another machine is not, even at the same path', async () => {
      expect(await appSpaceMade([[{ id: 'sp-vps', name: 'Subway Reader', machine: 'vps', folder: checkout, terminals: ['t1'] }], [{ address: 't1', live: checkout }]])).toBe(true);
    });

    test('a Checkout that is no longer a repository gets no space, and the Ticket its space all the same', async () => {
      rmSync(join(checkout, '.git'), { recursive: true });
      herdr(windowWith());
      expect(await step().open(subway)).toEqual({ opened: true });
      expect(done()).toEqual([{ 'space.new': { name: 'GF-12 Parse the feed', folder: worktree } }]);
    });

    test("a terminal the core cannot describe has no live folder, so its space's folder is its place", async () => {
      herdr(windowWith({ id: 'sp-x', name: 'x', folder: checkout, terminals: ['t1'] }), [{ address: 't1', live: home }], {}, { get: { code: 3, err: 'no terminal "t1"\n' } });
      await step().open(subway);
      expect(done()).toEqual([{ 'space.new': { name: 'GF-12 Parse the feed', folder: worktree } }]);
    });

    test('an App with no Checkout gets no space of its own, and the Ticket its space all the same', async () => {
      herdr(windowWith());
      expect(await step().open({ ...subway, app: { ...subway.app, checkout: null } })).toEqual({ opened: true });
      expect(done()).toEqual([{ 'space.new': { name: 'GF-12 Parse the feed', folder: worktree } }]);
    });
  });

  describe('finding the tools', () => {
    test("found in ~/.local/bin when PATH does not have them, which is the LaunchAgent's case", async () => {
      const local = join(home, '.local/bin');
      standIn('herdr-app', { ls: windowWith(), 'do space.new*': { out: { space: 's', tab: 'b', terminal: 't9' } } }, local);
      coreWith([], {}, local);
      expect(await step({ env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: home } }).open(subway)).toEqual({ opened: true });
      expect(done().at(-1)).toEqual({ 'space.new': { name: 'GF-12 Parse the feed', folder: worktree } });
    });

    test('PATH wins over ~/.local/bin', async () => {
      herdr(windowWith());
      standIn('hc', { '*': { code: 1, err: 'the wrong hc' } }, join(home, '.local/bin'));
      expect(await step().open(subway)).toEqual({ opened: true });
    });
  });

  describe('not opened, with a sentence saying what to start', () => {
    const whyNot = (over?: Parameters<typeof step>[0]) => step(over).open(subway).catch((e: Error) => e.message);

    test('Herdr not installed', async () => {
      expect(await whyNot({ appBundle: missing })).toBe('Herdr is not installed, so no terminal was opened: install Herdr 2 and open it once');
    });

    test('Herdr installed, its tools not found', async () => {
      expect(await whyNot()).toBe('Herdr is installed but hc and herdr-app were not found on PATH or in ~/.local/bin: open Herdr once so it puts them there');
    });

    test('one tool found and the other not', async () => {
      standIn('herdr-app', {});
      expect(await whyNot({ appBundle: missing })).toBe('Herdr is installed but hc was not found on PATH or in ~/.local/bin: open Herdr once so it puts it there');
      expect(calls()).toEqual([]);
    });

    test('its window not open', async () => {
      herdr({ code: 2, err: 'herdr-app: no Herdr window at /x/herdr-app.sock: No such file or directory (os error 2)\n' });
      expect(await whyNot()).toBe('Herdr is not open, so no terminal was opened: open the Herdr app and try again');
    });

    test('its core not running', async () => {
      herdr(windowWith(), [], {}, { ls: { code: 1, err: 'no core running\n' } });
      expect(await whyNot()).toBe("Herdr's core is not running, so no terminal was opened: run `hc server start` and try again (no core running)");
      expect(done()).toEqual([]);
    });

    test("Herdr refusing the App's space says what it said, and makes nothing for the Ticket", async () => {
      herdr(windowWith(), [], { 'do space.new*': { code: 1, out: { error: 'folder does not exist' } } });
      expect(await whyNot()).toBe("Herdr refused space.new for the App's space: folder does not exist");
      expect(done()).toEqual([{ 'space.new': { name: 'Subway Reader', folder: checkout } }]);
    });

    test("Herdr refusing the Ticket's space says what it said", async () => {
      herdr(windowWith(appSpace()[0]), [appSpace()[1]], { 'do space.new*': { code: 1, out: { error: 'folder does not exist' } } });
      expect(await whyNot()).toBe("Herdr refused space.new for the Ticket's space: folder does not exist");
    });

    test('a refusal that is not JSON gives what Herdr wrote to stderr', async () => {
      herdr(windowWith(appSpace()[0]), [appSpace()[1]], { 'do space.new*': { code: 2, raw: 'not json', err: 'herdr-app: no Herdr window\n' } });
      expect(await whyNot()).toBe("Herdr refused space.new for the Ticket's space: herdr-app: no Herdr window");
    });

    test('Herdr refusing to show the live terminal says what it said', async () => {
      herdr(windowWith({ id: 'sp-12', name: 'GF-12 Parse the feed', terminals: ['t4'] }), [ticketTerminal('t4')], { 'do pane.focus*': { code: 1, out: { error: 'no such terminal' } } });
      expect(await whyNot()).toBe("Herdr refused pane.focus for the Ticket's terminal: no such terminal");
    });

    test('a terminal that could not be tagged says so, since it could not be found again', async () => {
      herdr(windowWith(), [], {}, { label: { code: 1, err: 'no such terminal\n' } });
      expect(await whyNot()).toBe('Herdr made terminal t10 but it could not be tagged, so it will not be found again: no such terminal');
    });

    test('a tool that answers something else is not taken for Herdr', async () => {
      herdr({ out: { nonsense: true } });
      expect(await whyNot()).toBe("herdr-app ls answered in a shape this Goblin does not know: is it Herdr 2's?");
    });

    test('a tool that hangs is given up on', async () => {
      herdr({ hang: true });
      expect(await whyNot({ timeoutMs: 100 })).toBe('Herdr is not open, so no terminal was opened: open the Herdr app and try again');
    });
  });

  describe('chosen in the settings, behind Start and Open terminal', () => {
    let h: Awaited<ReturnType<typeof makeTestApp>>;
    let key: string;
    let started: string;
    afterEach(() => h.close());

    const post = async (path: string, body?: unknown) => (await h.app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();

    const trackerOn = async (appBundle: string) => {
      h = await makeTestApp({ terminals: { herdr: herdrTerminal({ env: { PATH: bin, HOME: home }, appBundle }) } });
      const worktreeRoot = join(scratch, 'tracker-worktrees');
      expect((await h.app.request('/api/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ terminal_step: 'herdr', worktree_root: worktreeRoot }) })).status).toBe(200);
      const app = await post('/api/apps', { name: 'Subway Reader', checkout });
      key = (await post('/api/tickets', { title: 'Parse the feed', status: 'ready', simple: true, app_id: app.id })).key;
      started = join(worktreeRoot, 'subway-reader', `${key.toLowerCase()}-parse-the-feed`);
    };

    test("Start makes the App's space on its Checkout, then the Ticket's on the Worktree it just made", async () => {
      herdr(windowWith());
      await trackerOn(installed);
      expect(await post(`/api/tickets/${key}/start`, {})).toMatchObject({ status: 'building', worktree_folder: started, terminal: { opened: true } });
      expect(done()).toEqual([{ 'space.new': { name: 'Subway Reader', folder: checkout } }, { 'space.new': { name: `${key} Parse the feed`, folder: started } }]);
    });

    test('Open terminal comes back to the space Start made', async () => {
      // the window as it will be once Start has made the Ticket's space, t9, under the App's
      herdr(windowWith({ id: 'sp-subway', name: 'Subway Reader', terminals: ['t1'] }, { id: 'sp-t9', name: 'the Ticket', terminals: ['t9'] }), [{ address: 't1', live: checkout }]);
      await trackerOn(installed);
      await post(`/api/tickets/${key}/start`, {});
      expect(await post(`/api/tickets/${key}/terminal`, {})).toMatchObject({ status: 'building', terminal: { opened: true } });
      expect(done().map((command) => Object.keys(command)[0])).toEqual(['space.new', 'pane.focus']);
      expect(done().at(-1)).toEqual({ 'pane.focus': { terminal: 't9' } });
    });

    test("after a stop and a Start on another branch, the Ticket's terminal left in the old Worktree is not the one shown", async () => {
      herdr(windowWith(appSpace()[0], { id: 'sp-t9', name: 'the Ticket', terminals: ['t9'] }), [appSpace()[1]]);
      await trackerOn(installed);
      await post(`/api/tickets/${key}/start`, {});
      await post(`/api/tickets/${key}/stop`);
      const moved = await post(`/api/tickets/${key}/start`, { branch: 'another' });
      expect(moved).toMatchObject({ worktree_branch: 'another', terminal: { opened: true } });
      expect(moved.worktree_folder).not.toBe(started);
      expect(done()).toEqual([{ 'space.new': { name: `${key} Parse the feed`, folder: started } }, { 'space.new': { name: `${key} Parse the feed`, folder: moved.worktree_folder } }]);
    });

    test('Herdr missing leaves the Ticket building with its Worktree, and the outcome says what to start', async () => {
      await trackerOn(missing);
      expect(await post(`/api/tickets/${key}/start`, {})).toMatchObject({
        status: 'building',
        worktree_folder: started,
        terminal: { opened: false, reason: 'Herdr is not installed, so no terminal was opened: install Herdr 2 and open it once', folder: started },
      });
    });
  });
});
