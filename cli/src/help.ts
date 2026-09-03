/**
 * `--help` at all three depths, generated from the command table so a verb can
 * never exist without documenting itself.
 */
import { flagSignature, flagUsage, type Flag } from './args';
import { GLOBAL_FLAGS, NOUNS, type Command, type Noun } from './commands';

/** Two columns, padded to the widest name — the whole of the house's help layout. */
function rows(pairs: [string, string][]): string {
  const width = Math.max(...pairs.map(([name]) => name.length));
  return pairs.map(([name, summary]) => `  ${name.padEnd(width)}  ${summary}`).join('\n');
}

const EXITS = 'exit codes:\n  0 done · 1 the API refused · 2 usage · 3 the API is unreachable\n\nA refusal is application/problem+json on stderr; stdout stays empty.';

export const rootHelp = (): string =>
  [
    'usage: goblin <noun> <verb> [operands] [flags]',
    '',
    'nouns:',
    rows(NOUNS.map((n) => [n.name, n.summary])),
    '',
    'flags:',
    rows(GLOBAL_FLAGS.map((f) => [flagSignature(f), f.summary])),
    '',
    EXITS,
    '',
    'GF_URL points at the API (default http://127.0.0.1:4747).',
  ].join('\n');

export const nounHelp = (noun: Noun): string =>
  [
    `usage: goblin ${noun.name} <verb> [operands] [flags]`,
    '',
    noun.summary,
    '',
    'verbs:',
    rows(noun.commands.map((c) => [c.verb, c.summary])),
    ...(noun.fallback ? ['', `\`goblin ${noun.name}\` on its own means \`goblin ${noun.name} ${noun.fallback}\`.`] : []),
    '',
    `\`goblin ${noun.name} <verb> --help\` for one verb.`,
  ].join('\n');

export const commandHelp = (noun: Noun, command: Command): string => {
  const operands = (command.operands ?? []).map((o) => `<${o.name}>`);
  const flags: Flag[] = command.flags ?? [];
  return [
    `usage: goblin ${noun.name} ${command.verb} ${[...operands, ...flags.map(flagUsage)].join(' ')}`.trimEnd(),
    '',
    command.summary,
    ...(command.operands?.length ? ['', 'operands:', rows(command.operands.map((o) => [`<${o.name}>`, o.summary]))] : []),
    ...(flags.length ? ['', 'flags:', rows(flags.map((f) => [flagSignature(f), f.required ? `${f.summary} (required)` : f.summary]))] : []),
  ].join('\n');
};
