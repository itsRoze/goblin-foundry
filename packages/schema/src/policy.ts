import { z } from 'zod';

// ── Per-project policy: three presets, everything overridable ──────────────
//
// A resolved policy is `preset -> project's stored override -> factory.policy.yaml`,
// deep-merged leaf by leaf (see policyResolve.ts). The schemas below come in
// pairs: a *complete* shape (every leaf required, used by a preset) and an
// *override* shape (every leaf optional at every level, used by a project row
// or a parsed policy file). Overrides never carry `.default()` — a field a
// human left unset must stay absent so the merge can inherit it from the layer
// below, not get silently filled in here.

/** Which runner executes a phase, and therefore which provider it can reach. */
export const HARNESSES = ['claude-code', 'pi'] as const;
export type Harness = (typeof HARNESSES)[number];

/** The only phases a model tier can name. A typo here must fail, not fall through. */
export const PHASE_NAMES = ['planner', 'builder', 'reviewer', 'librarian'] as const;
export type PhaseName = (typeof PHASE_NAMES)[number];
const phaseName = z.enum(PHASE_NAMES);

const DURATION_RE = /^\d+h$/;
/** Narrowest thing that expresses the blueprint's `1h` and `12h`. Nothing reads it yet. */
export const durationString = z.string().regex(DURATION_RE, 'expected a duration like "1h" or "12h"');

/** `required` | `skip` | an auto-approval window. Nothing reads the third form yet. */
export const designApprovalGate = z.union([
  z.enum(['required', 'skip']),
  z.object({ autoAfter: durationString }).strict(),
]);
export type DesignApprovalGate = z.infer<typeof designApprovalGate>;

const phasePolicyShape = {
  /**
   * `claude-code` reads `model` as a Claude alias (`opus`); `pi` reads it as
   * `provider/model` (`opencode-go/kimi-k3`), which is how a phase says which
   * lane it runs in without a second field to keep in sync.
   */
  harness: z.enum(HARNESSES),
  model: z.string(),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']),
  budgetUsd: z.number(),
  maxTurns: z.number(),
};
export const phasePolicy = z.object(phasePolicyShape).strict();
export type PhasePolicy = z.infer<typeof phasePolicy>;
const phasePolicyOverride = z.object(phasePolicyShape).strict().partial();
/** A phase tier's own field list, for "nearest sibling" suggestions in policyParse.ts. */
export const PHASE_POLICY_FIELDS: string[] = Object.keys(phasePolicyShape);

const gatesShape = {
  designApproval: designApprovalGate,
  prApproval: z.enum(['required', 'skip']),
  autoMerge: z.boolean(),
  deploy: z.enum(['auto', 'manual']),
};
const reviewShape = {
  lenses: z.array(z.string()),
  maxFixLoops: z.number(),
  blockOn: z.enum(['important', 'nit']),
};
const designShape = {
  mockups: z.enum(['html', 'figma']),
  storage: z.literal('factory-db'),
};
const toolsShape = {
  protectedPaths: z.array(z.string()),
  /** Absolute or `~`-relative paths agents may read outside their worktree. */
  readOnlyPaths: z.array(z.string()),
};
const commandsShape = {
  test: z.string(),
  typecheck: z.string(),
  build: z.string(),
  lint: z.string(),
  deploy: z.string(),
  verify: z.string(),
};
const budgetsShape = {
  perTicketUsd: z.number(),
  stallTimeoutMin: z.number(),
  maxConcurrentRuns: z.number(),
  gateRetries: z.number(),
};

/** Every section's own field list, single source of truth for both schemas below and "nearest sibling" suggestions in policyParse.ts. */
export const SECTION_FIELDS: Record<string, string[]> = {
  gates: Object.keys(gatesShape),
  review: Object.keys(reviewShape),
  design: Object.keys(designShape),
  tools: Object.keys(toolsShape),
  commands: Object.keys(commandsShape),
  budgets: Object.keys(budgetsShape),
};

export const policy = z.object({
  preset: z.enum(['serious', 'standard', 'vibe']),
  gates: z.object(gatesShape).strict(),
  review: z.object(reviewShape).strict(),
  models: z.record(phaseName, phasePolicy),
  design: z.object(designShape).strict(),
  tools: z.object(toolsShape).strict(),
  commands: z.object(commandsShape).strict(),
  budgets: z.object(budgetsShape).strict(),
}).strict();
export type Policy = z.infer<typeof policy>;

/** Every leaf optional at every level. A complete `Policy` also satisfies this. */
export const policyOverride = z.object({
  preset: z.enum(['serious', 'standard', 'vibe']),
  gates: z.object(gatesShape).strict().partial(),
  review: z.object(reviewShape).strict().partial(),
  models: z.partialRecord(phaseName, phasePolicyOverride),
  design: z.object(designShape).strict().partial(),
  tools: z.object(toolsShape).strict().partial(),
  commands: z.object(commandsShape).strict().partial(),
  budgets: z.object(budgetsShape).strict().partial(),
}).partial();
export type PolicyOverride = z.infer<typeof policyOverride>;

/** Top-level section names the factory implements. Anything else is a warning, not a typo. */
export const KNOWN_TOP_SECTIONS = ['preset', 'gates', 'review', 'models', 'design', 'tools', 'commands', 'budgets'] as const;

/**
 * Keys that once existed and were deliberately removed. Reported as a warning
 * naming the removal, never as an unknown key. One member today: the builder
 * Bash allowlist, which nothing has ever read — the builder's tool list is
 * hard-coded, and no command allowlist exists anywhere in the factory.
 */
export const RETIRED_KEYS: { section: string; key: string; message: string }[] = [
  {
    section: 'tools',
    key: 'builder_bash',
    message: "tools.builder_bash was removed and is not policy-driven — the builder's tool list is hard-coded, not configurable.",
  },
];

// Measured, not guessed: a three-round interview with the perspective
// subagents ran out of money at $6 with the design half-written. Turns are
// deliberately loose — the dollar budget is the leash, and a turn cap tight
// enough to bind stops correct work rather than runaway work.
// Every lane on claude-code since 2026-08-25: the OpenCode Go window ran out
// mid-milestone (429 GoUsageLimitError) and killed three planner runs at $0,
// so the cheap lane turned out to have a plan window of its own. The planner
// cannot be a pi tier at all as the harness stands — piTools() maps only
// read/find/grep/bash/write/edit/ls, so there is no AskUserQuestion and no
// grill round (docs/LESSONS.md, FAC-26). serious and vibe reuse these same
// ids and spend up/down through effort, budget and turns instead of guessing
// at a stronger or cheaper model id this codebase has never run.
const STANDARD_MODELS = {
  planner: { harness: 'claude-code', model: 'opus', effort: 'high', budgetUsd: 15, maxTurns: 200 },
  builder: { harness: 'claude-code', model: 'sonnet', effort: 'xhigh', budgetUsd: 12, maxTurns: 300 },
  reviewer: { harness: 'claude-code', model: 'opus', effort: 'high', budgetUsd: 10, maxTurns: 200 },
  librarian: { harness: 'claude-code', model: 'haiku', effort: 'low', budgetUsd: 1, maxTurns: 60 },
} as const;

// A function, not a shared constant: each preset gets its own array so that
// resolving a policy — which can return a preset's own array untouched, as a
// leaf inherited by every layer — never hands out a reference two presets share.
const sharedTools = (): Policy['tools'] => ({ protectedPaths: ['.github/**', 'infra/**', 'docs/plan/**'], readOnlyPaths: [] });
const SHARED_DESIGN = { mockups: 'html', storage: 'factory-db' } as const;
const SHARED_COMMANDS = { test: 'pnpm test', typecheck: 'pnpm typecheck', build: 'pnpm build', lint: '', deploy: '', verify: '' };

/** The three blueprint presets. Each is a complete `Policy` — no leaf may inherit from nowhere. */
export const POLICY_PRESETS: Record<'serious' | 'standard' | 'vibe', Policy> = {
  serious: {
    preset: 'serious',
    gates: { designApproval: 'required', prApproval: 'required', autoMerge: false, deploy: 'manual' },
    review: {
      lenses: ['correctness', 'security', 'performance', 'tests', 'maintainability', 'ux'],
      maxFixLoops: 3, blockOn: 'important',
    },
    models: {
      planner: { ...STANDARD_MODELS.planner, effort: 'max', budgetUsd: 25, maxTurns: 300 },
      builder: { ...STANDARD_MODELS.builder, effort: 'max', budgetUsd: 20, maxTurns: 400 },
      reviewer: { ...STANDARD_MODELS.reviewer, effort: 'max', budgetUsd: 18, maxTurns: 300 },
      librarian: { ...STANDARD_MODELS.librarian, effort: 'high', budgetUsd: 2, maxTurns: 100 },
    },
    design: SHARED_DESIGN,
    tools: sharedTools(),
    commands: SHARED_COMMANDS,
    budgets: { perTicketUsd: 80, stallTimeoutMin: 60, maxConcurrentRuns: 2, gateRetries: 4 },
  },
  standard: {
    preset: 'standard',
    gates: { designApproval: 'required', prApproval: 'skip', autoMerge: true, deploy: 'auto' },
    review: { lenses: ['correctness', 'security', 'tests', 'maintainability'], maxFixLoops: 3, blockOn: 'important' },
    models: { ...STANDARD_MODELS },
    design: SHARED_DESIGN,
    tools: sharedTools(),
    commands: SHARED_COMMANDS,
    budgets: { perTicketUsd: 40, stallTimeoutMin: 30, maxConcurrentRuns: 2, gateRetries: 2 },
  },
  vibe: {
    preset: 'vibe',
    gates: { designApproval: { autoAfter: '1h' }, prApproval: 'skip', autoMerge: true, deploy: 'auto' },
    review: { lenses: ['correctness', 'tests'], maxFixLoops: 2, blockOn: 'important' },
    models: {
      planner: { ...STANDARD_MODELS.planner, effort: 'low', budgetUsd: 5, maxTurns: 100 },
      builder: { ...STANDARD_MODELS.builder, effort: 'low', budgetUsd: 6, maxTurns: 150 },
      reviewer: { ...STANDARD_MODELS.reviewer, effort: 'low', budgetUsd: 4, maxTurns: 100 },
      librarian: { ...STANDARD_MODELS.librarian },
    },
    design: SHARED_DESIGN,
    tools: sharedTools(),
    commands: SHARED_COMMANDS,
    budgets: { perTicketUsd: 15, stallTimeoutMin: 15, maxConcurrentRuns: 2, gateRetries: 1 },
  },
};
