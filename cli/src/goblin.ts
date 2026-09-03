#!/usr/bin/env bun
import { DEFAULT_PORT } from '@goblin/shared';
import { runGoblin } from './run';

const base = process.env.GF_URL ?? `http://127.0.0.1:${DEFAULT_PORT}`;
const { code, out, err } = await runGoblin(process.argv.slice(2), {
  fetch: (path, init) => fetch(new URL(path, base), init),
});

/** Data on stdout, refusals on stderr, never both — so `goblin … | jq` is safe on any exit code. */
const write = (stream: { write(text: string): unknown }, text: string) => {
  if (text !== '') stream.write(text.endsWith('\n') ? text : `${text}\n`);
};
write(process.stdout, out);
write(process.stderr, err);
process.exit(code);
