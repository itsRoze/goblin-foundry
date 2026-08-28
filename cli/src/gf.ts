#!/usr/bin/env bun
import { runGf } from './run';

const { code, out } = await runGf(process.argv.slice(2), {
  fetch: (path, init) => fetch(new URL(path, process.env.GF_URL ?? 'http://127.0.0.1:4747'), init),
});
process.stdout.write(out + '\n');
process.exit(code);
