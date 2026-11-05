import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { herdrTerminal } from '../src/herdr';
import type { TerminalRequest } from '../src/terminal';
import { makeTestApp } from './harness';

type Answer = { out?: unknown; raw?: string; err?: string; code?: number; hang?: boolean };

const SUBWAY: TerminalRequest = { app: { id: 7, name: 'Subway Reader' }, ticket: { key: 'GF-12', title: 'Parse the feed' }, folder: '/worktrees/subway-reader/gf-12' };

/** `herdr-app ls`: spaces > tabs > terminals, in the shape the real one printed. */
const windowWith = (...spaces: { id: string; name: string; machine?: string | null; terminals?: string[] }[]) => ({
  out: {
    spaces: spaces.map((s) => ({
      id: s.id,
      name: s.name,
      folder: '/somewhere',
      machine: s.machine ?? null,
      active: false,
      tabs: (s.terminals ?? []).map((terminal, i) => ({ id: `tab-${terminal}`, name: String(i + 1), active: i === 0, settled: false, terminals: [{ terminal, pane: `pane-${terminal}`, status: null, app: null, name: null, sub_agents: [] }] })),
    })),
  },
});

/** `hc ls`: the terminals carrying a label, in the shape the real one printed. */
const labelled = (...addresses: string[]) => ({ out: { hidden_finished: 0, terminals: addresses.map((address) => ({ address, agent: 'zsh', cwd: '/somewhere', state: 'live', turn: 0 })) } });

describe('the Herdr terminal step, against stand-ins on a temporary PATH', () => {
  let scratch: string;
  let bin: string;
  let home: string;
  let log: string;
  let installed: string;
  let missing: string;

  beforeEach(() => {
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'gf-herdr-')));
    bin = join(scratch, 'bin');
    home = join(scratch, 'home');
    log = join(scratch, 'calls');
    installed = join(scratch, 'Herdr.app');
    missing = join(scratch, 'Nothing.app');
    mkdirSync(bin);
    mkdirSync(home);
    mkdirSync(installed);
    writeFileSync(log, '');
  });
  afterEach(() => rmSync(scratch, { recursive: true, force: true }));

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
      const body = answer.hang ? 'exec /bin/sleep 30' : `/bin/cat '${out}'; /bin/cat '${err}' >&2; exit ${answer.code ?? 0}`;
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

  /** Every call, in order, one array of arguments each. */
  const calls = () =>
    readFileSync(log, 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => line.split('\t'));

  /** The call to `herdr-app do <command>`, with its one JSON object read back. */
  const did = (command: string) => {
    const call = calls().find((c) => c[0] === 'herdr-app' && c[1] === 'do' && c[2] === command);
    return call && JSON.parse(call[3]!);
  };
  const doneCommands = () => calls().filter((c) => c[1] === 'do').map((c) => c[2]);
  const labels = () => calls().find((c) => c[0] === 'hc' && c[1] === 'label')?.slice(2);

  const step = (over: Partial<Parameters<typeof herdrTerminal>[0]> = {}) => herdrTerminal({ env: { PATH: bin, HOME: home }, appBundle: installed, ...over });

  /** A Herdr with a window: whatever the test does not say answers as "nothing there yet". */
  const herdr = (window: Answer, tagged: { ticket?: string[]; app?: string[] } = {}, over: { hc?: Record<string, Answer>; app?: Record<string, Answer> } = {}) => {
    standIn('herdr-app', { ls: window, 'do space.new*': { out: { space: 'sp-new', tab: 'tb-new', terminal: 't9' } }, 'do tab.new*': { out: { space: 'sp-there', tab: 'tb-new', terminal: 't9' } }, 'do pane.focus*': { out: { ok: true } }, ...over.app });
    standIn('hc', { 'ls --json --label goblin.ticket=*': labelled(...(tagged.ticket ?? [])), 'ls --json --label goblin.app=*': labelled(...(tagged.app ?? [])), 'label *': { out: {} }, ...over.hc });
  };

  describe('first open', () => {
    test('with no space for the App, makes one named after the App, holding a tab named by Ticket Key and title in the Worktree', async () => {
      herdr(windowWith({ id: 'sp-other', name: 'Another App', terminals: ['t1'] }));
      expect(await step().open(SUBWAY)).toEqual({ opened: true });
      expect(did('space.new')).toEqual({ name: 'Subway Reader', folder: '/worktrees/subway-reader/gf-12', tab: 'GF-12 Parse the feed' });
      expect(did('tab.new')).toBeUndefined();
    });

    test('tags the terminal it made with the Ticket Key and the App', async () => {
      herdr(windowWith());
      await step().open(SUBWAY);
      expect(labels()).toEqual(['t9', 'goblin.ticket=GF-12', 'goblin.app=7']);
    });

    test('runs no program: the terminal is whatever shell Herdr starts', async () => {
      herdr(windowWith());
      await step().open(SUBWAY);
      expect(did('space.new').argv).toBeUndefined();
    });

    test("with the App's space already there, makes a tab in it", async () => {
      herdr(windowWith({ id: 'sp-other', name: 'Another App' }, { id: 'sp-subway', name: 'Subway Reader', terminals: ['t1'] }));
      expect(await step().open(SUBWAY)).toEqual({ opened: true });
      expect(did('tab.new')).toEqual({ name: 'GF-12 Parse the feed', space: 'sp-subway', folder: '/worktrees/subway-reader/gf-12' });
      expect(did('space.new')).toBeUndefined();
    });

    test("a space renamed away from the App's name is still the App's while one of its terminals carries the App", async () => {
      herdr(windowWith({ id: 'sp-renamed', name: 'Reader, old name', terminals: ['t3'] }, { id: 'sp-decoy', name: 'Subway Reader' }), { app: ['t3'] });
      await step().open(SUBWAY);
      expect(did('tab.new').space).toBe('sp-renamed');
    });

    test("a same-named space on another machine is not this App's", async () => {
      herdr(windowWith({ id: 'sp-remote', name: 'Subway Reader', machine: 'vps' }));
      await step().open(SUBWAY);
      expect(did('tab.new')).toBeUndefined();
      expect(did('space.new').name).toBe('Subway Reader');
    });

    test('a title that looks like JSON or a flag arrives as the name, untouched', async () => {
      herdr(windowWith({ id: 'sp-subway', name: 'Subway Reader' }));
      await step().open({ ...SUBWAY, ticket: { key: 'GF-12', title: '--confirmed "true" {"a":1}' } });
      expect(did('tab.new').name).toBe('GF-12 --confirmed "true" {"a":1}');
    });
  });

  describe('opening again', () => {
    test('a live terminal for the Ticket is shown, and nothing is made', async () => {
      herdr(windowWith({ id: 'sp-subway', name: 'Subway Reader', terminals: ['t1', 't4'] }), { ticket: ['t4'] });
      expect(await step().open(SUBWAY)).toEqual({ opened: true });
      expect(doneCommands()).toEqual(['pane.focus']);
      expect(did('pane.focus')).toEqual({ terminal: 't4' });
      expect(labels()).toBeUndefined();
    });

    test('after it has been closed, a fresh one is made in the same Worktree', async () => {
      herdr(windowWith({ id: 'sp-subway', name: 'Subway Reader', terminals: ['t1'] }));
      expect(await step().open(SUBWAY)).toEqual({ opened: true });
      expect(did('tab.new')).toEqual({ name: 'GF-12 Parse the feed', space: 'sp-subway', folder: '/worktrees/subway-reader/gf-12' });
    });

    test('a terminal the core still calls live but the window no longer shows counts as closed', async () => {
      // what `hc ls` says for a moment after a tab is closed
      herdr(windowWith({ id: 'sp-subway', name: 'Subway Reader', terminals: ['t1'] }), { ticket: ['t4'], app: ['t4'] });
      expect(await step().open(SUBWAY)).toEqual({ opened: true });
      expect(doneCommands()).toEqual(['tab.new']);
      expect(did('tab.new').space).toBe('sp-subway');
    });
  });

  describe('finding the tools', () => {
    test("found in ~/.local/bin when PATH does not have them, which is the LaunchAgent's case", async () => {
      standIn('herdr-app', { ls: windowWith(), 'do space.new*': { out: { space: 's', tab: 'b', terminal: 't9' } } }, join(home, '.local/bin'));
      standIn('hc', { 'ls --json --label *': labelled(), 'label *': { out: {} } }, join(home, '.local/bin'));
      const launchd = '/usr/bin:/bin:/usr/sbin:/sbin';
      expect(await step({ env: { PATH: launchd, HOME: home } }).open(SUBWAY)).toEqual({ opened: true });
      expect(did('space.new').name).toBe('Subway Reader');
    });

    test('PATH wins over ~/.local/bin', async () => {
      herdr(windowWith());
      standIn('hc', { '*': { code: 1, err: 'the wrong hc' } }, join(home, '.local/bin'));
      expect(await step().open(SUBWAY)).toEqual({ opened: true });
    });
  });

  describe('not opened, with a sentence saying what to start', () => {
    const folder = SUBWAY.folder;

    test('Herdr not installed', async () => {
      expect(await step({ appBundle: missing }).open(SUBWAY)).toEqual({ opened: false, reason: 'Herdr is not installed, so no terminal was opened: install Herdr 2 and open it once', folder });
    });

    test('Herdr installed, its tools not found', async () => {
      expect(await step().open(SUBWAY)).toEqual({ opened: false, reason: 'Herdr is installed but hc and herdr-app were not found on PATH or in ~/.local/bin: open Herdr once so it puts them there', folder });
    });

    test('one tool found and the other not', async () => {
      standIn('herdr-app', {});
      expect(await step({ appBundle: missing }).open(SUBWAY)).toEqual({ opened: false, reason: 'Herdr is installed but hc was not found on PATH or in ~/.local/bin: open Herdr once so it puts it there', folder });
      expect(calls()).toEqual([]);
    });

    test('its window not open', async () => {
      herdr({ code: 2, err: 'herdr-app: no Herdr window at /x/herdr-app.sock: No such file or directory (os error 2)\n' });
      expect(await step().open(SUBWAY)).toEqual({ opened: false, reason: 'Herdr is not open, so no terminal was opened: open the Herdr app and try again', folder });
    });

    test('its core not running', async () => {
      herdr(windowWith(), {}, { hc: { 'ls --json --label goblin.ticket=*': { code: 1, err: 'no core running\n' } } });
      expect(await step().open(SUBWAY)).toEqual({ opened: false, reason: "Herdr's core is not running, so no terminal was opened: run `hc server start` and try again (no core running)", folder });
      expect(doneCommands()).toEqual([]);
    });

    test('Herdr refusing the new tab says what it said', async () => {
      herdr(windowWith(), {}, { app: { 'do space.new*': { code: 1, out: { error: 'folder does not exist' } } } });
      expect(await step().open(SUBWAY)).toEqual({ opened: false, reason: 'Herdr refused space.new: folder does not exist', folder });
    });

    test('a refusal that is not JSON gives what Herdr wrote to stderr', async () => {
      herdr(windowWith(), {}, { app: { 'do space.new*': { code: 2, raw: 'not json', err: 'herdr-app: no Herdr window\n' } } });
      expect(await step().open(SUBWAY)).toEqual({ opened: false, reason: 'Herdr refused space.new: herdr-app: no Herdr window', folder });
    });

    test('a terminal that could not be tagged says so, since it could not be found again', async () => {
      herdr(windowWith(), {}, { hc: { 'label *': { code: 1, err: 'no such terminal\n' } } });
      expect(await step().open(SUBWAY)).toEqual({ opened: false, reason: 'Herdr made terminal t9 but it could not be tagged, so it will not be found again: no such terminal', folder });
    });

    test('a tool that answers something else is not taken for Herdr', async () => {
      herdr({ out: { nonsense: true } });
      expect(await step().open(SUBWAY)).toEqual({ opened: false, reason: "herdr-app ls answered in a shape this Goblin does not know: is it Herdr 2's?", folder });
    });

    test('a tool that hangs is given up on', async () => {
      herdr({ hang: true });
      expect(await step({ timeoutMs: 100 }).open(SUBWAY)).toEqual({ opened: false, reason: 'Herdr is not open, so no terminal was opened: open the Herdr app and try again', folder });
    });
  });

  describe('chosen in the settings, behind Start and Open terminal', () => {
    let h: Awaited<ReturnType<typeof makeTestApp>>;
    let key: string;
    let worktree: string;
    afterEach(() => h.close());

    const post = async (path: string, body?: unknown) => (await h.app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();

    const trackerOn = async (appBundle: string) => {
      const repo = join(scratch, 'subway-reader');
      mkdirSync(repo);
      for (const args of [['init', '-q', '-b', 'main'], ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'first']]) expect(Bun.spawnSync(['git', ...args], { cwd: repo }).exitCode).toBe(0);
      h = await makeTestApp({ terminals: { herdr: herdrTerminal({ env: { PATH: bin, HOME: home }, appBundle }) } });
      const worktreeRoot = join(scratch, 'worktrees');
      expect((await h.app.request('/api/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ terminal_step: 'herdr', worktree_root: worktreeRoot }) })).status).toBe(200);
      const app = await post('/api/apps', { name: 'Subway Reader', checkout: repo });
      key = (await post('/api/tickets', { title: 'Parse the feed', status: 'ready', simple: true, app_id: app.id })).key;
      worktree = join(worktreeRoot, 'subway-reader', `${key.toLowerCase()}-parse-the-feed`);
    };

    test('Start opens the shell in the Worktree it just made, under the space for the App', async () => {
      herdr(windowWith());
      await trackerOn(installed);
      const started = await post(`/api/tickets/${key}/start`, {});
      expect(started).toMatchObject({ status: 'building', worktree_folder: worktree, terminal: { opened: true } });
      expect(did('space.new')).toEqual({ name: 'Subway Reader', folder: worktree, tab: `${key} Parse the feed` });
    });

    test('Open terminal comes back to the tagged one', async () => {
      herdr(windowWith({ id: 'sp-subway', name: 'Subway Reader', terminals: ['t4'] }), { ticket: ['t4'] });
      await trackerOn(installed);
      await post(`/api/tickets/${key}/start`, {});
      expect(await post(`/api/tickets/${key}/terminal`, {})).toMatchObject({ status: 'building', terminal: { opened: true } });
      expect(doneCommands()).toEqual(['pane.focus', 'pane.focus']);
    });

    test('Herdr missing leaves the Ticket building with its Worktree, and the outcome says what to start', async () => {
      await trackerOn(missing);
      expect(await post(`/api/tickets/${key}/start`, {})).toMatchObject({
        status: 'building',
        worktree_folder: worktree,
        terminal: { opened: false, reason: 'Herdr is not installed, so no terminal was opened: install Herdr 2 and open it once', folder: worktree },
      });
    });
  });
});
