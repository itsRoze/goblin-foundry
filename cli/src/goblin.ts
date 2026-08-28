#!/usr/bin/env bun
import { DEFAULT_PORT } from '@goblin/shared';
import { runGoblin } from './run';

const { code, out } = await runGoblin(process.argv.slice(2), {
  fetch: (path, init) => fetch(new URL(path, process.env.GF_URL ?? `http://127.0.0.1:${DEFAULT_PORT}`), init),
});
process.stdout.write(out + '\n');
process.exit(code);
