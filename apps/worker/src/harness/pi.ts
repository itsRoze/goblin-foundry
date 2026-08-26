import {
  createAgentSession, DefaultResourceLoader, getAgentDir, ModelRuntime, SessionManager,
  SettingsManager, type ExtensionAPI,
} from '@earendil-works/pi-coding-agent';
import * as db from '../db.ts';
import { checkTool } from '../guard.ts';
import { asHalt } from '../halt.ts';
import { derivePaymentMethod, isBillable, isPaymentMismatch } from '../payment.ts';
import type { PhaseResult, PhaseRun } from '../phase.ts';

/**
 * The second harness.
 *
 * A phase is a contract, not a vendor: a prompt in, a typed envelope out, tool
 * calls and cost on the way. `pi` runs that contract in-process against any
 * provider it can authenticate — OpenCode Go by default — which is what makes
 * an expensive Claude plan window optional rather than load-bearing.
 *
 * The M1 slice is deliberately thin: session, prompt, events, usage. There is no
 * structured-output mode, so the envelope is parsed out of the final text the
 * same way the Claude runner's fallback does. The worktree boundary is real
 * here — pi's `tool_call` hook can block, so the same `checkTool` that guards a
 * Claude phase denies a pi one before the tool runs, not after.
 */

/** `opencode-go/kimi-k3` — how a phase names a model it wants. */
export function parseModelRef(ref: string): { provider: string; model: string } | null {
  const slash = ref.indexOf('/');
  if (slash <= 0 || slash === ref.length - 1) return null;
  return { provider: ref.slice(0, slash), model: ref.slice(slash + 1) };
}

/** pi's built-in tool names, mapped from the names the phases already use. */
const TOOL_NAMES: Record<string, string> = {
  Read: 'read', Glob: 'find', Grep: 'grep', Bash: 'bash',
  Write: 'write', Edit: 'edit', LS: 'ls',
};

export function piTools(allowed: string[]): string[] {
  return [...new Set(allowed.map(t => TOOL_NAMES[t]).filter((t): t is string => Boolean(t)))];
}

type Usage = { input?: number; output?: number; cacheRead?: number; cacheWrite?: number;
               cost?: { total?: number } };

/**
 * The worktree boundary, as pi enforces it. `tool_call` fires before the tool
 * runs and can block, which is the same contract the Claude runner gets from a
 * PreToolUse hook — so one `checkTool` covers both harnesses and a denial is
 * recorded identically in the trace.
 */
export function guardExtension(
  p: PhaseRun, onBreach: (tool: string, input: unknown, reason: string) => void,
) {
  return {
    name: 'goblin-guard',
    factory: (pi: ExtensionAPI) => {
      pi.on('tool_call', event => {
        const breach = checkTool(toolLabel(event.toolName), event.input, p.cwd, p.protectedPaths);
        if (!breach) return;
        onBreach(event.toolName, event.input, breach.reason);
        return { block: true, reason: `${breach.reason}. Stay inside your worktree.` };
      });
    },
  };
}

/**
 * Runs one phase through pi. Same signature as the Claude runner, same events,
 * same PhaseResult — the sequencer cannot tell which one it called.
 */
export async function runPiPhase(p: PhaseRun, prompt: string, resume?: string): Promise<PhaseResult> {
  const started = new Date();
  const ref = parseModelRef(p.model) ?? { provider: 'opencode-go', model: p.model };
  // The provider named in the model reference is evidence available before the
  // session even starts, unlike the Claude harness, which waits for the init
  // message. There is no separate "declared vs. observed" gap here.
  const observedPaidBy = derivePaymentMethod({
    harness: 'pi', provider: ref.provider, credentialSource: null, declared: p.declaredPaidBy,
  });

  await db.event({
    runId: p.runId, phaseId: p.phaseId, type: 'agent_start', name: p.agent,
    payload: {
      harness: 'pi', provider: ref.provider, model: ref.model, effort: p.effort,
      resumed: resume ?? null, tools: p.allowedTools, budget_usd: p.maxBudgetUsd,
      payment_method: observedPaidBy,
    },
    startedAt: started,
  });
  if (isPaymentMismatch(p.declaredPaidBy, observedPaidBy)) {
    await db.event({
      runId: p.runId, phaseId: p.phaseId, type: 'error', name: 'payment_mismatch',
      payload: { declared: p.declaredPaidBy, observed: observedPaidBy, provider: ref.provider },
    });
  }

  let denied = 0;
  const modelRuntime = await ModelRuntime.create();
  const model = modelRuntime.getModel(ref.provider, ref.model);
  if (!model) {
    const known = (await modelRuntime.getAvailable()).slice(0, 8)
      .map(m => `${m.provider}/${m.id}`).join(', ');
    throw new Error(`pi has no model ${ref.provider}/${ref.model} (available: ${known || 'none'})`);
  }

  const guard = guardExtension(p, (tool, input, reason) => {
    denied += 1;
    void db.event({
      runId: p.runId, phaseId: p.phaseId, type: 'error', name: 'permission_breach',
      payload: { harness: 'pi', tool, input: truncate(input), reason },
    }).catch(() => {});
  });
  const resourceLoader = new DefaultResourceLoader({
    cwd: p.cwd,
    agentDir: getAgentDir(),
    settingsManager: SettingsManager.create(p.cwd, getAgentDir()),
    extensionFactories: [guard],
    // A run means the same thing on any machine: no project extensions, skills
    // or prompt templates the repository happens to carry.
    noSkills: true,
    noPromptTemplates: true,
  });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    cwd: p.cwd,
    model,
    thinkingLevel: p.effort === 'xhigh' || p.effort === 'max' ? 'high' : p.effort,
    tools: piTools(p.allowedTools),
    resourceLoader,
    sessionManager: SessionManager.inMemory(),
  });

  // pi has no system-prompt option at construction; the agent's state carries it.
  session.agent.state.systemPrompt = `${session.agent.state.systemPrompt ?? ''}\n\n${p.systemPrompt}`.trim();

  const usage = { costUsd: 0, inputTokens: 0, outputTokens: 0,
                  cacheReadTokens: 0, cacheWriteTokens: 0, numTurns: 0 };
  const open = new Map<string, { eventId: string; startedAt: Date }>();
  let text = '';

  const unsubscribe = session.subscribe(event => {
    void (async () => {
      try {
        if (event.type === 'tool_execution_start') {
          // Denials are the guard extension's business; this only records what
          // actually ran, so a blocked call is not counted twice.
          const startedAt = new Date();
          const eventId = await db.event({
            runId: p.runId, phaseId: p.phaseId, type: 'tool_call',
            name: `${event.toolName}${describe(event.args)}`,
            payload: { harness: 'pi', tool: event.toolName, input: truncate(event.args) },
            startedAt,
          });
          open.set(String(event.toolCallId ?? eventId), { eventId, startedAt });
        } else if (event.type === 'tool_execution_end') {
          const span = open.get(String(event.toolCallId ?? ''));
          if (!span) return;
          open.delete(String(event.toolCallId ?? ''));
          await db.endToolEvent(span.eventId, {
            tool: event.toolName, ok: !event.isError, result: truncate(event.result),
            duration_ms: Date.now() - span.startedAt.getTime(),
          }, new Date());
        } else if (event.type === 'turn_end') {
          usage.numTurns += 1;
          const message = event.message as { content?: unknown[]; usage?: Usage };
          const u = message?.usage;
          if (u) {
            usage.inputTokens += u.input ?? 0;
            usage.outputTokens += u.output ?? 0;
            usage.cacheReadTokens += u.cacheRead ?? 0;
            usage.cacheWriteTokens += u.cacheWrite ?? 0;
            usage.costUsd += u.cost?.total ?? 0;
          }
          for (const block of (message?.content ?? []) as { type?: string; text?: string }[]) {
            if (block.type === 'text' && block.text?.trim()) {
              text = block.text;
              await db.event({ runId: p.runId, phaseId: p.phaseId, type: 'message',
                               name: 'assistant', payload: { harness: 'pi', text: block.text.slice(0, 4000) } });
            }
          }
        }
      } catch (e) { console.error('pi event', e); }
    })();
  });

  let terminalReason = 'completed';
  let ok = true;
  try {
    await db.updatePhase(p.phaseId, { sessionId: session.sessionId, observedPaidBy });
    await session.prompt(prompt);
    await session.agent.waitForIdle();
  } catch (e) {
    ok = false;
    const halt = asHalt(e);
    terminalReason = halt?.reason ?? 'error';
    await db.event({ runId: p.runId, phaseId: p.phaseId, type: 'error',
                     name: terminalReason, payload: { harness: 'pi', error: String((e as Error).message ?? e).slice(0, 1000) } });
    if (halt) { unsubscribe(); session.dispose(); throw halt; }
  } finally {
    unsubscribe();
  }

  const error = session.agent.state.errorMessage;
  if (error) { ok = false; terminalReason = 'agent_error'; }

  await db.updatePhase(p.phaseId, { usage });
  await db.addRunCost(p.runId, usage, isBillable(observedPaidBy));
  await db.event({
    runId: p.runId, phaseId: p.phaseId, type: 'agent_end', name: p.agent,
    tokens: usage.inputTokens + usage.outputTokens,
    payload: { harness: 'pi', terminal_reason: terminalReason, cost_usd: usage.costUsd,
               usage, denied_tools: denied, session_id: session.sessionId, error: error ?? null,
               payment_method: observedPaidBy },
  });

  const sessionId = session.sessionId;
  session.dispose();
  // pi has no structured-output mode: the envelope is whatever JSON the agent
  // ended with, which is the same fallback the Claude runner already carries.
  return { sessionId, ok, structured: undefined, text, terminalReason, usage };
}

function toolLabel(name: string): string {
  const entry = Object.entries(TOOL_NAMES).find(([, pi]) => pi === name);
  return entry?.[0] ?? name;
}

function describe(args: unknown): string {
  const a = (args ?? {}) as Record<string, unknown>;
  const detail = typeof a.command === 'string' ? a.command
    : typeof a.path === 'string' ? a.path
    : typeof a.file_path === 'string' ? a.file_path
    : typeof a.pattern === 'string' ? a.pattern : '';
  return detail ? `: ${detail.slice(0, 100)}` : '';
}

function truncate(value: unknown, max = 4000): unknown {
  const json = JSON.stringify(value ?? null);
  if (json === undefined) return null;
  return json.length <= max ? JSON.parse(json) : { truncated: true, preview: json.slice(0, max) };
}
