import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { report, type BuildOutput, type GateCheck, type GateReport } from '@goblin/schema';
import { changedFiles, shell } from './git.ts';

/**
 * Gates verify claims, never predictions: they run after the fact, against the
 * envelope's own declarations, and a green gate says what it verified.
 */
export type Gate = (env: BuildOutput, ctx: GateContext) => Promise<GateReport>;
export type GateContext = { worktree: string; base: string; testCommand: string };

export const tests_pass: Gate = async (_env, ctx) => {
  if (!ctx.testCommand) {
    return report('tests_pass', [{ item: 'test command', ok: true, note: 'none configured — skipped' }]);
  }
  const res = await shell(ctx.testCommand, ctx.worktree);
  const tail = (res.stdout + res.stderr).trim().slice(-1000);
  return report('tests_pass', [{
    item: ctx.testCommand,
    ok: res.code === 0,
    note: res.code === 0 ? `exit 0${tail ? ` · ${tail.split('\n').at(-1)}` : ''}` : `exit ${res.code} · ${tail}`,
  }]);
};

export const diff_matches_claims: Gate = async (env, ctx) => {
  const actual = new Set(await changedFiles(ctx.worktree, ctx.base));
  const checks: GateCheck[] = [];
  for (const claimed of env.changed_files) {
    const onDisk = existsSync(join(ctx.worktree, claimed));
    const inDiff = actual.has(claimed);
    checks.push({
      item: claimed,
      ok: inDiff || onDisk,
      note: inDiff ? 'in the diff' : onDisk ? 'exists on disk, not in the diff' : 'not in the diff and not on disk',
    });
  }
  const unclaimed = [...actual].filter(f => !env.changed_files.includes(f));
  if (unclaimed.length) {
    checks.push({
      item: 'undeclared changes',
      ok: false,
      note: `changed but not in changed_files: ${unclaimed.slice(0, 10).join(', ')}`,
    });
  }
  if (!checks.length) {
    checks.push({ item: 'changed_files', ok: false, note: 'the envelope claims no changed files' });
  }
  return report('diff_matches_claims', checks);
};

export const GATES: Gate[] = [tests_pass, diff_matches_claims];
