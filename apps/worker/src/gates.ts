import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  report, type BuildOutput, type EnvelopeBase, type GateCheck, type GateReport, type PlanOutput,
} from '@goblin/schema';
import { changedFiles, shell } from './git.ts';

/**
 * Gates verify claims, never predictions: they run after the fact, against the
 * envelope's own declarations, and a green gate says what it verified. Each
 * phase declares its own gates — a builder gate reads BuildOutput fields a
 * reviewer gate would not have.
 */
export type Gate<E extends EnvelopeBase = BuildOutput> = (env: E, ctx: GateContext) => Promise<GateReport>;
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

// ── Design gates: a design has to earn Design Review ─────────────────────────

/** The sections a design must carry before a human is asked to read it. */
const REQUIRED_SECTIONS = ['Problem Statement', 'Acceptance Criteria', 'Out of Scope'];
/** Present in the template, so still present means the section was never written. */
const PLACEHOLDERS = [
  'The problem from the user\'s perspective',
  '<ticket title>',
  'EARS-flavoured and independently verifiable',
];
const EARS = /^\s*(?:[-*]\s*)?(?:\*\*)?(WHEN|IF|WHILE)\b[\s\S]{0,400}?\bSHALL\b/gim;

/** The body of one `## Section`, or null when the heading is absent. */
export function section(markdown: string, name: string): string | null {
  const heading = new RegExp(`^#{1,6}\\s*${name}\\s*$`, 'im');
  const match = heading.exec(markdown);
  if (!match) return null;
  const after = markdown.slice(match.index + match[0].length);
  const next = /^#{1,6}\s+\S/m.exec(after);
  return (next ? after.slice(0, next.index) : after).trim();
}

/** Every EARS-shaped acceptance criterion in a design. */
export function earsCriteria(markdown: string): string[] {
  const body = section(markdown, 'Acceptance Criteria') ?? '';
  return (body.match(EARS) ?? []).map(line => line.trim().replace(/\s+/g, ' '));
}

/**
 * FAC-7: the planner's own gate. It reads the design the way a builder would —
 * are the sections there, are the criteria testable, is anything still marked
 * unclear — and reports what it found per check, not a verdict.
 */
export const design_complete: Gate<PlanOutput> = async env => {
  const md = env.design_markdown ?? '';
  const checks: GateCheck[] = [];

  checks.push({
    item: 'design present',
    ok: md.trim().length > 400,
    note: `${md.trim().length} characters`,
  });

  for (const name of REQUIRED_SECTIONS) {
    const body = section(md, name);
    checks.push({
      item: `section: ${name}`,
      ok: body !== null && body.length > 20,
      note: body === null ? 'heading missing' : body.length > 20 ? `${body.length} characters` : 'heading present but empty',
    });
  }

  const clarifications = md.match(/\[NEEDS CLARIFICATION[^\]]*\]/gi) ?? [];
  checks.push({
    item: 'no [NEEDS CLARIFICATION]',
    ok: clarifications.length === 0,
    note: clarifications.length ? `${clarifications.length} left: ${clarifications.slice(0, 3).join(', ')}` : 'none',
  });

  const criteria = earsCriteria(md);
  checks.push({
    item: 'EARS acceptance criteria',
    ok: criteria.length >= 2,
    note: criteria.length ? `${criteria.length}: ${criteria[0]!.slice(0, 80)}…` : 'none found — WHEN/IF/WHILE … SHALL',
  });

  const leftovers = PLACEHOLDERS.filter(p => md.includes(p));
  checks.push({
    item: 'template placeholders replaced',
    ok: leftovers.length === 0,
    note: leftovers.length ? `still present: ${leftovers.join(' | ')}` : 'none',
  });

  return report('design_complete', checks);
};

/**
 * The human's copy of the design has to be readable in a sandboxed frame: no
 * scripts to run, no external resources to fetch, and enough of it to be worth
 * opening.
 */
export const review_readable: Gate<PlanOutput> = async env => {
  const html = env.review_html ?? '';
  const scripts = html.match(/<script\b|\son\w+\s*=|javascript:/gi) ?? [];
  const remote = html.match(/(?:src|href)\s*=\s*["']?(?:https?:)?\/\//gi) ?? [];
  return report('review_readable', [
    { item: 'review document present', ok: html.trim().length > 500, note: `${html.trim().length} characters` },
    { item: 'sections a human reads', ok: /<h[12]\b/i.test(html), note: /<h[12]\b/i.test(html) ? 'headings present' : 'no headings' },
    { item: 'no scripts', ok: scripts.length === 0, note: scripts.length ? `${scripts.length}: ${scripts.slice(0, 3).join(', ')}` : 'none' },
    { item: 'no external resources', ok: remote.length === 0, note: remote.length ? `${remote.length} remote src/href` : 'none' },
  ]);
};

/**
 * The envelope has to agree with itself: a design reported as done cannot also
 * be waiting on an answer.
 */
export const verdict_consistent: Gate<PlanOutput> = async env => {
  const open = env.open_questions ?? [];
  return report('verdict_consistent', [{
    item: 'no open questions on a successful design',
    ok: env.status !== 'success' || open.length === 0,
    note: open.length ? `${open.length} open: ${open.slice(0, 3).join(' | ')}` : 'none',
  }]);
};
