import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

/**
 * A stand-in for Herdr's core, `hc`, run as `fake-hc.ts <core.json> <calls> <args>`.
 * It holds terminals with the folder each was launched in, the folder its
 * foreground program is in now, and labels. It answers `ls` by the labels asked
 * for, all of them, `get` with both folders, and `label` by setting them, as the
 * real one does. A command named under `fail` answers that instead; anything
 * else exits 99.
 */

type Terminal = { address: string; launched: string; live: string | null; labels: Record<string, string> };
type Core = { terminals: Terminal[]; fail?: Record<string, { code: number; err: string }> };

const [corePath, log, ...args] = process.argv.slice(2) as [string, string, ...string[]];
appendFileSync(log, `${['hc', ...args].join('\t')}\n`);
const core = JSON.parse(readFileSync(corePath, 'utf8')) as Core;
const [command, ...rest] = args;

const failure = command && core.fail?.[command];
if (failure) {
  process.stderr.write(failure.err);
  process.exit(failure.code);
}

if (command === 'ls' && rest[0] === '--json') {
  const wanted = rest.slice(1).flatMap((arg, i, all) => (all[i - 1] === '--label' ? [arg.split(/=(.*)/s).slice(0, 2) as [string, string]] : []));
  const terminals = core.terminals.filter((t) => wanted.every(([key, value]) => t.labels[key] === value));
  // `cwd` is the launch folder, as the real one prints it
  console.log(JSON.stringify({ hidden_finished: 0, terminals: terminals.map((t) => ({ address: t.address, agent: 'zsh', cwd: t.launched, state: 'live', turn: 0 })) }));
} else if (command === 'get' && rest[1] === '--json') {
  const terminal = core.terminals.find((t) => t.address === rest[0]);
  if (!terminal) {
    console.log(JSON.stringify({ error: { kind: 'not_found', message: `no terminal "${rest[0]}"` } }));
    process.exit(3);
  }
  const foreground = terminal.live === null ? null : { argv: ['/bin/zsh', '-l'], cwd: terminal.live, name: 'zsh', pid: 1 };
  console.log(JSON.stringify({ address: terminal.address, argv: ['/bin/zsh', '-l'], cwd: terminal.launched, foreground, labels: terminal.labels, state: 'live' }));
} else if (command === 'label' && rest.length > 1) {
  const [address, ...pairs] = rest as [string, ...string[]];
  // a terminal the window just made is in the core already, but nobody told this stand-in its folder
  const terminal = core.terminals.find((t) => t.address === address) ?? (core.terminals.push({ address, launched: '/somewhere', live: null, labels: {} }), core.terminals.at(-1)!);
  for (const pair of pairs) {
    const [key, value] = pair.split(/=(.*)/s) as [string, string];
    terminal.labels[key] = value;
  }
  writeFileSync(corePath, JSON.stringify(core));
  console.log('{}');
} else {
  process.exit(99);
}
