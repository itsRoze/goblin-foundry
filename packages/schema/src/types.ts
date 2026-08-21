import { z } from 'zod';

/** Canonical status kinds. Agents trigger on these; per-project names are display only. */
export const STATUS_KINDS = [
  'backlog', 'ready_for_design', 'designing', 'design_review', 'ready_for_dev',
  'building', 'in_review', 'ready_to_merge', 'deploying', 'done', 'canceled',
] as const;
export type StatusKind = (typeof STATUS_KINDS)[number];
export const statusKind = z.enum(STATUS_KINDS);

export const EVENT_TYPES = [
  'phase_start', 'agent_start', 'message', 'tool_call', 'question', 'answer',
  'gate_pass', 'gate_fail', 'handoff', 'log', 'error', 'agent_end', 'phase_end',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

// ── Envelopes: the only seam between agents ─────────────────────────────────
// Field names are snake_case because agents emit them as JSON.

export const envelopeBase = z.object({
  status: z.enum(['success', 'fail']),
  summary: z.string().default(''),
  artifacts: z.array(z.string()).default([]),
  notes_for_next_agent: z.string().default(''),
});
export type EnvelopeBase = z.infer<typeof envelopeBase>;

export const buildOutput = envelopeBase.extend({
  changed_files: z.array(z.string()).default([]),
  commit_message: z.string().default(''),
  evidence: z.array(z.object({
    what: z.string(),
    command: z.string().default(''),
    output: z.string().default(''),
  })).default([]),
  deviations: z.array(z.string()).default([]),
  handoff: z.string().default(''),
});
export type BuildOutput = z.infer<typeof buildOutput>;

export const planOutput = envelopeBase.extend({
  design_markdown: z.string(),
  /** The same design written for a human: overview, mockups, decisions. */
  review_html: z.string().default(''),
  open_questions: z.array(z.string()).default([]),
});
export type PlanOutput = z.infer<typeof planOutput>;

/** One lens's verdict on one requirement — never merged into a single ranking. */
export const finding = z.object({
  lens: z.string(),
  requirement: z.string(),
  met: z.boolean(),
  evidence: z.string().default(''),
  severity: z.enum(['important', 'nit', 'pre-existing']).default('nit'),
  refuted: z.boolean().default(false),
  refutation: z.string().default(''),
});
export type Finding = z.infer<typeof finding>;

export const reviewOutput = envelopeBase.extend({
  lenses_run: z.array(z.string()).default([]),
  findings: z.array(finding).default([]),
  verdict: z.enum(['approve', 'changes_requested']),
});
export type ReviewOutput = z.infer<typeof reviewOutput>;

/** What still blocks after refutation: unmet, important, and not refuted. */
export function blockingFindings(env: ReviewOutput, blockOn: 'important' | 'nit'): Finding[] {
  return env.findings.filter(f =>
    !f.met && !f.refuted &&
    (f.severity === 'important' || (blockOn === 'nit' && f.severity === 'nit')));
}

export const ENVELOPES = {
  GenericOutput: envelopeBase, BuildOutput: buildOutput,
  PlanOutput: planOutput, ReviewOutput: reviewOutput,
};
export type EnvelopeName = keyof typeof ENVELOPES;

/** Draft-07 JSON Schema for the Agent SDK's `outputFormat`. */
export function envelopeJsonSchema(name: EnvelopeName): Record<string, unknown> {
  return z.toJSONSchema(ENVELOPES[name], { target: 'draft-7', io: 'input' }) as Record<string, unknown>;
}

// ── Gates: evidence, not a boolean ──────────────────────────────────────────

export const gateCheck = z.object({
  item: z.string(),   // what was checked: a path, a command, a test
  ok: z.boolean(),
  note: z.string().default(''),   // the evidence: "exit 0", "not in the diff"
});
export type GateCheck = z.infer<typeof gateCheck>;

export type GateReport = { gate: string; passed: boolean; checks: GateCheck[] };

export function report(gate: string, checks: GateCheck[]): GateReport {
  return { gate, passed: checks.every(c => c.ok), checks };
}
export function violations(r: GateReport): string[] {
  return r.checks.filter(c => !c.ok).map(c => `${c.item}: ${c.note || 'failed'}`);
}

// ── Per-project policy (M0: typed object, hard-coded preset) ────────────────

export const phasePolicy = z.object({
  model: z.string(),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']),
  budgetUsd: z.number(),
  maxTurns: z.number().default(60),
});

export const policy = z.object({
  preset: z.enum(['serious', 'standard', 'vibe']),
  gates: z.object({
    designApproval: z.enum(['required', 'skip']),
    prApproval: z.enum(['required', 'skip']),
    autoMerge: z.boolean(),
    deploy: z.enum(['auto', 'manual']),
  }),
  review: z.object({
    lenses: z.array(z.string()),
    maxFixLoops: z.number(),
    blockOn: z.enum(['important', 'nit']),
  }),
  models: z.record(z.string(), phasePolicy),
  design: z.object({
    mockups: z.enum(['html', 'figma']),
    storage: z.literal('factory-db'),
  }),
  tools: z.object({
    builderBash: z.array(z.string()),
    protectedPaths: z.array(z.string()),
  }),
  commands: z.object({
    test: z.string(),
    typecheck: z.string().default(''),
    build: z.string().default(''),
    lint: z.string().default(''),
    deploy: z.string().default(''),
    verify: z.string().default(''),
  }),
  budgets: z.object({
    perTicketUsd: z.number(),
    stallTimeoutMin: z.number(),
    maxConcurrentRuns: z.number(),
    gateRetries: z.number(),
  }),
});
export type Policy = z.infer<typeof policy>;

/** The `standard` preset, hard-coded for M0. */
export const STANDARD_PRESET: Policy = {
  preset: 'standard',
  gates: { designApproval: 'required', prApproval: 'skip', autoMerge: true, deploy: 'auto' },
  review: { lenses: ['correctness', 'security', 'tests', 'maintainability'], maxFixLoops: 3, blockOn: 'important' },
  models: {
    // Measured, not guessed: a three-round interview with the perspective
    // subagents ran out of money at $6 with the design half-written.
    planner: { model: 'opus', effort: 'high', budgetUsd: 15, maxTurns: 60 },
    builder: { model: 'sonnet', effort: 'xhigh', budgetUsd: 12, maxTurns: 80 },
    reviewer: { model: 'opus', effort: 'high', budgetUsd: 10, maxTurns: 40 },
    librarian: { model: 'haiku', effort: 'low', budgetUsd: 1, maxTurns: 20 },
  },
  design: { mockups: 'html', storage: 'factory-db' },
  tools: {
    builderBash: ['pnpm test*', 'pnpm typecheck', 'pnpm lint', 'pnpm build', 'git *', 'gh pr *'],
    protectedPaths: ['.github/**', 'infra/**', 'docs/plan/**'],
  },
  commands: { test: 'pnpm test', typecheck: 'pnpm typecheck', build: 'pnpm build', lint: '', deploy: '', verify: '' },
  budgets: { perTicketUsd: 40, stallTimeoutMin: 30, maxConcurrentRuns: 2, gateRetries: 2 },
};
