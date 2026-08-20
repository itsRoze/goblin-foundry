import { query, type HookCallback, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import * as db from './db.ts';
import { checkTool } from './guard.ts';

export type PhaseRun = {
  runId: string;
  phaseId: string;
  agent: string;
  cwd: string;
  model: string;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  maxTurns: number;
  maxBudgetUsd: number;
  allowedTools: string[];
  systemPrompt: string;
  protectedPaths: string[];
  jsonSchema?: Record<string, unknown>;
};

export type PhaseResult = {
  sessionId: string;
  ok: boolean;
  structured: unknown;
  text: string;
  terminalReason: string;
  usage: db.Usage;
};

const ZERO_USAGE: db.Usage = {
  costUsd: 0, inputTokens: 0, outputTokens: 0,
  cacheReadTokens: 0, cacheWriteTokens: 0, numTurns: 0,
};

/**
 * One `query()` per phase: its own model, effort, tool allowlist, budget and
 * envelope schema, and its own clean cost line from `result.modelUsage`.
 * Pass `resume` to correct a phase inside the same session instead of restarting it.
 */
export async function runPhase(p: PhaseRun, prompt: string, resume?: string): Promise<PhaseResult> {
  const started = new Date();
  await db.event({
    runId: p.runId, phaseId: p.phaseId, type: 'agent_start', name: p.agent,
    payload: {
      model: p.model, effort: p.effort, resumed: resume ?? null,
      tools: p.allowedTools, max_turns: p.maxTurns, budget_usd: p.maxBudgetUsd,
    },
    startedAt: started,
  });

  // Two writers per tool call: PreToolUse inserts with the input, PostToolUse
  // closes the span with duration_ms — the only first-class per-tool duration.
  const openCalls = new Map<string, { eventId: string; startedAt: Date }>();

  const onPreTool: HookCallback = async input => {
    if (input.hook_event_name !== 'PreToolUse') return {};
    const breach = checkTool(input.tool_name, input.tool_input, p.cwd, p.protectedPaths);
    if (breach) {
      await db.event({
        runId: p.runId, phaseId: p.phaseId, type: 'error', name: 'permission_breach',
        payload: { tool: input.tool_name, input: truncate(input.tool_input), reason: breach.reason },
      }).catch(() => {});
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `${breach.reason}. Stay inside your worktree.`,
        },
      };
    }
    const startedAt = new Date();
    try {
      const eventId = await db.event({
        runId: p.runId, phaseId: p.phaseId, type: 'tool_call',
        name: describe(input.tool_name, input.tool_input),
        payload: { tool: input.tool_name, input: truncate(input.tool_input), agent_id: input.agent_id ?? null },
        startedAt,
      });
      openCalls.set(input.tool_use_id, { eventId, startedAt });
    } catch (e) { console.error('PreToolUse hook', e); }
    return {};
  };

  const onPostTool: HookCallback = async input => {
    if (input.hook_event_name !== 'PostToolUse' && input.hook_event_name !== 'PostToolUseFailure') return {};
    const open = openCalls.get(input.tool_use_id);
    if (!open) return {};
    openCalls.delete(input.tool_use_id);
    const failed = input.hook_event_name === 'PostToolUseFailure';
    const durationMs = (input as { duration_ms?: number }).duration_ms
      ?? Date.now() - open.startedAt.getTime();
    try {
      await db.endToolEvent(open.eventId, {
        tool: input.tool_name,
        input: truncate(input.tool_input),
        ok: !failed,
        duration_ms: durationMs,
        result: truncate(failed ? (input as { error?: unknown }).error
                                : (input as { tool_response?: unknown }).tool_response),
      }, new Date(open.startedAt.getTime() + durationMs));
    } catch (e) { console.error('PostToolUse hook', e); }
    return {};
  };

  const options: Options = {
    cwd: p.cwd,
    model: p.model,
    effort: p.effort,
    maxTurns: p.maxTurns,
    maxBudgetUsd: p.maxBudgetUsd,
    allowedTools: p.allowedTools,
    permissionMode: 'bypassPermissions',
    settingSources: [],
    systemPrompt: {
      type: 'preset', preset: 'claude_code',
      append: p.systemPrompt, excludeDynamicSections: true,
    },
    includePartialMessages: false,
    hooks: {
      PreToolUse: [{ hooks: [onPreTool] }],
      PostToolUse: [{ hooks: [onPostTool] }],
      PostToolUseFailure: [{ hooks: [onPostTool] }],
    },
    sessionStore: {
      append: async (key, entries) =>
        db.appendTranscript(key.projectKey, key.sessionId, key.subpath ?? '', entries),
      load: async key => (await db.loadTranscript(key.sessionId, key.subpath ?? '')) as never,
    },
    ...(p.jsonSchema ? { outputFormat: { type: 'json_schema', schema: p.jsonSchema } } : {}),
    ...(resume ? { resume } : {}),
  };

  let sessionId = resume ?? '';
  let structured: unknown;
  let text = '';
  let ok = false;
  let terminalReason = 'unknown';
  let usage = { ...ZERO_USAGE };

  for await (const message of query({ prompt, options }) as AsyncIterable<SDKMessage>) {
    if (message.type === 'system' && message.subtype === 'init') {
      sessionId = message.session_id;
      await db.updatePhase(p.phaseId, { sessionId });
    } else if (message.type === 'assistant') {
      const blocks = message.message.content as { type: string; text?: string }[];
      for (const block of blocks) {
        if (block.type === 'text' && block.text?.trim()) {
          text = block.text;
          await db.event({
            runId: p.runId, phaseId: p.phaseId, type: 'message', name: 'assistant',
            payload: { text: block.text.slice(0, 4000), subagent: message.parent_tool_use_id ?? null },
          });
        }
      }
    } else if (message.type === 'result') {
      sessionId ||= message.session_id;
      terminalReason = message.subtype === 'success' ? 'completed' : message.subtype;
      ok = message.subtype === 'success' && !message.is_error;
      structured = (message as { structured_output?: unknown }).structured_output;
      if (message.subtype === 'success') text = message.result || text;
      // modelUsage covers subagents and compaction; `usage` does not.
      usage = { ...ZERO_USAGE, numTurns: message.num_turns };
      for (const m of Object.values(message.modelUsage ?? {})) {
        usage.costUsd += m.costUSD ?? 0;
        usage.inputTokens += m.inputTokens ?? 0;
        usage.outputTokens += m.outputTokens ?? 0;
        usage.cacheReadTokens += m.cacheReadInputTokens ?? 0;
        usage.cacheWriteTokens += m.cacheCreationInputTokens ?? 0;
      }
      if (!usage.costUsd) usage.costUsd = message.total_cost_usd ?? 0;
    }
  }

  await db.updatePhase(p.phaseId, { usage });
  await db.addRunCost(p.runId, usage);
  await db.event({
    runId: p.runId, phaseId: p.phaseId, type: 'agent_end', name: p.agent,
    tokens: usage.inputTokens + usage.outputTokens,
    payload: { terminal_reason: terminalReason, cost_usd: usage.costUsd, usage, session_id: sessionId },
  });

  return { sessionId, ok, structured, text, terminalReason, usage };
}

/** "bash: pnpm test", "edit: src/index.ts" — a name a human can scan in a lane. */
function describe(tool: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const detail =
    typeof i.command === 'string' ? i.command :
    typeof i.file_path === 'string' ? i.file_path :
    typeof i.pattern === 'string' ? i.pattern :
    typeof i.description === 'string' ? i.description : '';
  const name = `${tool.toLowerCase()}${detail ? `: ${detail}` : ''}`;
  return name.length > 120 ? `${name.slice(0, 117)}…` : name;
}

function truncate(value: unknown, max = 4000): unknown {
  const json = JSON.stringify(value ?? null);
  if (json === undefined) return null;
  return json.length <= max ? JSON.parse(json) : { truncated: true, preview: json.slice(0, max) };
}
