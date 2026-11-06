#!/usr/bin/env bun
/**
 * The browser suite split into shards and run at once on this machine, each shard its own
 * Playwright process, port and empty database: `bun run test:e2e:par [--shards N] [playwright args]`.
 * One worker over one database takes about thirteen minutes; eight shards take about five. Twelve
 * were faster still but failed two specs that pass alone, so eight is the default.
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'test-results/par');

type Stats = { expected: number; unexpected: number; flaky: number; skipped: number };
type Shard = { index: number; log: string; report: string; exitCode: number; ms: number };

function parseArgs(argv: string[]): { shards: number; rest: string[] } {
  const rest: string[] = [];
  let shards = 8;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--shards') shards = Number(argv[++i]);
    else if (arg.startsWith('--shards=')) shards = Number(arg.slice('--shards='.length));
    else if (/^--(shard|output|reporter)\b/.test(arg)) throw new Error(`${arg.split('=')[0]} is the script's own; run playwright directly to choose it`);
    else rest.push(arg);
  }
  if (!Number.isInteger(shards) || shards < 1) throw new Error(`--shards takes a whole number above 0, got ${shards}`);
  return { shards, rest };
}

// All held open at once so the OS cannot hand the same port out twice.
async function freePorts(count: number): Promise<number[]> {
  const servers = await Promise.all(
    Array.from({ length: count }, () => new Promise<ReturnType<typeof createServer>>((resolve) => {
      const server = createServer();
      server.listen(0, '127.0.0.1', () => resolve(server));
    })),
  );
  const ports = servers.map((s) => (s.address() as { port: number }).port);
  await Promise.all(servers.map((s) => new Promise((resolve) => s.close(resolve))));
  return ports;
}

function readStats(report: string): Stats | null {
  if (!existsSync(report)) return null;
  return (JSON.parse(readFileSync(report, 'utf8')) as { stats: Stats }).stats;
}

function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

const { shards, rest } = parseArgs(process.argv.slice(2));
const started = Date.now();

const build = Bun.spawnSync(['bun', 'run', 'build'], { cwd: ROOT, stdout: 'inherit', stderr: 'inherit' });
if (build.exitCode !== 0) process.exit(build.exitCode ?? 1);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const ports = await freePorts(shards);

const children: ReturnType<typeof Bun.spawn>[] = [];
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    // Playwright tears its server and browsers down on SIGINT only; a SIGTERM leaves them orphaned.
    for (const child of children) child.kill('SIGINT');
    await Promise.all(children.map((child) => child.exited));
    process.exit(signal === 'SIGINT' ? 130 : 143);
  });
}

const results: Shard[] = await Promise.all(
  ports.map(async (port, i) => {
    const index = i + 1;
    const log = join(OUT, `shard-${index}.log`);
    const report = join(OUT, `shard-${index}.json`);
    const fd = openSync(log, 'w');
    const t0 = Date.now();
    const child = Bun.spawn(
      ['bunx', 'playwright', 'test', `--shard=${index}/${shards}`, '--output', join(OUT, `shard-${index}`), '--reporter=list,json', ...rest],
      {
        cwd: ROOT,
        env: { ...process.env, GF_E2E_PORT: String(port), GF_E2E_PREBUILT: '1', PLAYWRIGHT_JSON_OUTPUT_FILE: report },
        stdout: fd,
        stderr: fd,
      },
    );
    children.push(child);
    const exitCode = await child.exited;
    closeSync(fd);
    return { index, log, report, exitCode, ms: Date.now() - t0 };
  }),
);

let ran = 0;
for (const r of results) {
  const stats = readStats(r.report);
  if (stats) ran += stats.expected + stats.unexpected + stats.flaky + stats.skipped;
  const counts = stats
    ? `${stats.expected} passed, ${stats.unexpected} failed, ${stats.flaky} flaky, ${stats.skipped} skipped`
    : 'no report';
  const verdict = r.exitCode === 0 ? 'ok  ' : 'FAIL';
  console.log(`${verdict} shard ${r.index}/${shards}  ${counts}  ${duration(r.ms)}  ${relative(process.cwd(), r.log)}`);
}
console.log(`wall ${duration(Date.now() - started)}`);
// A shard with no tests exits 0, so a mistyped spec path would otherwise read as a pass.
if (ran === 0) console.log('no tests ran');
process.exit(ran === 0 || results.some((r) => r.exitCode !== 0) ? 1 : 0);
