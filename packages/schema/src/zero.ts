import {
  createSchema, table, string, number, boolean, json, enumeration, relationships,
} from '@rocicorp/zero';
import type { ReadonlyJSONValue } from '@rocicorp/zero';
import type { StatusKind } from './types.ts';

// Zero syncs the stable, interactive data. The high-frequency `event` table is
// deliberately absent — it reaches the browser over SSE. See docs/DECISIONS.md.
// Postgres is snake_case; every mapping is explicit via .from().

const project = table('project').columns({
  id: string(),
  slug: string(),
  key: string(),
  name: string(),
  repoPath: string().from('repo_path'),
  repoRemote: string().from('repo_remote').optional(),
  defaultBranch: string().from('default_branch'),
  policy: json(),
  createdAt: number().from('created_at'),
  updatedAt: number().from('updated_at'),
}).primaryKey('id');

const status = table('status').columns({
  id: string(),
  projectId: string().from('project_id'),
  kind: enumeration<StatusKind>(),
  name: string(),
  color: string(),
  sortOrder: number().from('sort_order'),
  enabled: boolean(),
}).primaryKey('id');

const ticket = table('ticket').columns({
  id: string(),
  projectId: string().from('project_id'),
  shortId: number().from('short_id'),
  title: string(),
  body: string(),
  type: enumeration<'feature' | 'bug' | 'chore' | 'proposal'>(),
  statusId: string().from('status_id'),
  priority: number(),
  sizeHint: string().from('size_hint').optional(),
  scope: json<{ included: string[]; excluded: string[] }>(),
  assignee: string().optional(),
  delegate: string().optional(),
  createdAt: number().from('created_at'),
  updatedAt: number().from('updated_at'),
}).primaryKey('id');

const comment = table('comment').columns({
  id: string(),
  ticketId: string().from('ticket_id'),
  author: string(),
  body: string(),
  createdAt: number().from('created_at'),
}).primaryKey('id');

const label = table('label').columns({
  id: string(),
  projectId: string().from('project_id'),
  name: string(),
  color: string(),
}).primaryKey('id');

const ticketLabel = table('ticketLabel').from('ticket_label').columns({
  ticketId: string().from('ticket_id'),
  labelId: string().from('label_id'),
}).primaryKey('ticketId', 'labelId');

const design = table('design').columns({
  id: string(),
  ticketId: string().from('ticket_id'),
  version: number(),
  status: enumeration<'draft' | 'in_review' | 'approved' | 'rejected' | 'superseded'>(),
  markdown: string(),
  reviewHtml: string().from('review_html').optional(),
  notes: json<ReadonlyJSONValue[]>(),
  createdBy: string().from('created_by'),
  approvedBy: string().from('approved_by').optional(),
  approvedAt: number().from('approved_at').optional(),
  createdAt: number().from('created_at'),
}).primaryKey('id');

const run = table('run').columns({
  id: string(),
  ticketId: string().from('ticket_id'),
  projectId: string().from('project_id'),
  designId: string().from('design_id').optional(),
  trigger: string(),
  worktree: string().optional(),
  branch: string().optional(),
  status: enumeration<'queued' | 'running' | 'awaiting_input' | 'success' | 'fail' | 'canceled'>(),
  terminalReason: string().from('terminal_reason').optional(),
  costUsd: number().from('cost_usd'),
  inputTokens: number().from('input_tokens'),
  outputTokens: number().from('output_tokens'),
  cacheReadTokens: number().from('cache_read_tokens'),
  cacheWriteTokens: number().from('cache_write_tokens'),
  leaseExpiresAt: number().from('lease_expires_at').optional(),
  heartbeatAt: number().from('heartbeat_at').optional(),
  pid: number().optional(),
  host: string().optional(),
  startedAt: number().from('started_at'),
  endedAt: number().from('ended_at').optional(),
}).primaryKey('id');

const phase = table('phase').columns({
  id: string(),
  runId: string().from('run_id'),
  seq: number(),
  kind: enumeration<'agent' | 'code' | 'human'>(),
  name: string(),
  agent: string().optional(),
  harness: string(),
  model: string().optional(),
  effort: string().optional(),
  sessionId: string().from('session_id').optional(),
  attempt: number(),
  retries: number(),
  status: enumeration<'queued' | 'running' | 'awaiting_input' | 'success' | 'fail'>(),
  error: string().optional(),
  compiledPromptRef: string().from('compiled_prompt_ref').optional(),
  costUsd: number().from('cost_usd'),
  inputTokens: number().from('input_tokens'),
  outputTokens: number().from('output_tokens'),
  cacheReadTokens: number().from('cache_read_tokens'),
  cacheWriteTokens: number().from('cache_write_tokens'),
  numTurns: number().from('num_turns'),
  startedAt: number().from('started_at').optional(),
  endedAt: number().from('ended_at').optional(),
}).primaryKey('id');

const envelope = table('envelope').columns({
  id: string(),
  phaseId: string().from('phase_id'),
  agent: string(),
  outputType: string().from('output_type'),
  payload: json(),
  raw: string().optional(),
  valid: boolean(),
  attempt: number(),
  createdAt: number().from('created_at'),
}).primaryKey('id');

const gate = table('gate').columns({
  id: string(),
  phaseId: string().from('phase_id'),
  attempt: number(),
  gate: string(),
  passed: boolean(),
  checks: json<{ item: string; ok: boolean; note: string }[]>(),
  createdAt: number().from('created_at'),
}).primaryKey('id');

const question = table('question').columns({
  id: string(),
  phaseId: string().from('phase_id'),
  runId: string().from('run_id').optional(),
  seq: number(),
  header: string(),
  prompt: string(),
  options: json<{ label: string; description: string }[]>(),
  multiSelect: boolean().from('multi_select'),
  recommended: string().optional(),
  answer: string().optional(),
  answeredBy: string().from('answered_by').optional(),
  askedAt: number().from('asked_at'),
  answeredAt: number().from('answered_at').optional(),
}).primaryKey('id');

const projectRel = relationships(project, ({ many }) => ({
  statuses: many({ sourceField: ['id'], destSchema: status, destField: ['projectId'] }),
  tickets: many({ sourceField: ['id'], destSchema: ticket, destField: ['projectId'] }),
  labels: many({ sourceField: ['id'], destSchema: label, destField: ['projectId'] }),
}));

const ticketRel = relationships(ticket, ({ one, many }) => ({
  project: one({ sourceField: ['projectId'], destSchema: project, destField: ['id'] }),
  status: one({ sourceField: ['statusId'], destSchema: status, destField: ['id'] }),
  comments: many({ sourceField: ['id'], destSchema: comment, destField: ['ticketId'] }),
  designs: many({ sourceField: ['id'], destSchema: design, destField: ['ticketId'] }),
  runs: many({ sourceField: ['id'], destSchema: run, destField: ['ticketId'] }),
  labels: many(
    { sourceField: ['id'], destSchema: ticketLabel, destField: ['ticketId'] },
    { sourceField: ['labelId'], destSchema: label, destField: ['id'] },
  ),
}));

const runRel = relationships(run, ({ one, many }) => ({
  ticket: one({ sourceField: ['ticketId'], destSchema: ticket, destField: ['id'] }),
  design: one({ sourceField: ['designId'], destSchema: design, destField: ['id'] }),
  phases: many({ sourceField: ['id'], destSchema: phase, destField: ['runId'] }),
  questions: many({ sourceField: ['id'], destSchema: question, destField: ['runId'] }),
}));

const phaseRel = relationships(phase, ({ one, many }) => ({
  run: one({ sourceField: ['runId'], destSchema: run, destField: ['id'] }),
  envelopes: many({ sourceField: ['id'], destSchema: envelope, destField: ['phaseId'] }),
  gates: many({ sourceField: ['id'], destSchema: gate, destField: ['phaseId'] }),
  questions: many({ sourceField: ['id'], destSchema: question, destField: ['phaseId'] }),
}));

const questionRel = relationships(question, ({ one }) => ({
  phase: one({ sourceField: ['phaseId'], destSchema: phase, destField: ['id'] }),
  run: one({ sourceField: ['runId'], destSchema: run, destField: ['id'] }),
}));

const designRel = relationships(design, ({ one }) => ({
  ticket: one({ sourceField: ['ticketId'], destSchema: ticket, destField: ['id'] }),
}));

const statusRel = relationships(status, ({ many }) => ({
  tickets: many({ sourceField: ['id'], destSchema: ticket, destField: ['statusId'] }),
}));

export const schema = createSchema({
  tables: [project, status, ticket, comment, label, ticketLabel, design, run, phase, envelope, gate, question],
  relationships: [projectRel, ticketRel, runRel, phaseRel, designRel, statusRel, questionRel],
});

export type Schema = typeof schema;
