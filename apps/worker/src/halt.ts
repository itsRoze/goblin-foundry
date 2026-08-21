/**
 * Some failures are not the agent's fault and not worth retrying: the money ran
 * out, the plan window closed, the process was told to stop. They end the phase
 * with a reason a human can read on the board instead of a stack trace, and
 * without spending another attempt to learn the same thing.
 */
export class HaltError extends Error {
  constructor(readonly reason: string, message: string) {
    super(message);
    this.name = 'HaltError';
  }
}

const SIGNATURES: [RegExp, string][] = [
  [/reached maximum budget/i, 'budget_exhausted'],
  [/maximum number of turns/i, 'turn_limit'],
  [/session limit|usage limit|rate limit|quota/i, 'usage_limit'],
  [/credit balance|insufficient funds/i, 'no_credit'],
];

/** Recognises the failures that mean "stop", from whatever the SDK threw. */
export function haltReasonFor(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return SIGNATURES.find(([pattern]) => pattern.test(message))?.[1] ?? null;
}

export function asHalt(error: unknown): HaltError | null {
  if (error instanceof HaltError) return error;
  const reason = haltReasonFor(error);
  return reason ? new HaltError(reason, error instanceof Error ? error.message : String(error)) : null;
}

/**
 * A halt that leaves real work behind in the worktree. The agent is still
 * resumable, so it is worth one more turn asking it to stop and report rather
 * than throwing the session away with the work unreported.
 */
export function worthWrappingUp(reason: string): boolean {
  return reason === 'turn_limit' || reason === 'budget_exhausted';
}

/** The per-ticket cap from policy, checked before spending another attempt. */
export function overBudget(spent: number, capUsd: number): boolean {
  return capUsd > 0 && spent >= capUsd;
}
