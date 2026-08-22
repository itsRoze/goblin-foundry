/**
 * The circuit breaker.
 *
 * A specific guard stops the loop you thought of. This one stops the loop you
 * did not: it watches the *rate* of runs rather than their reason, so any cause
 * — a claim guard defeated by a bug, a phase that fails instantly, two workers
 * racing — trips the same wire. It cost 12,357 runs in two hours to learn that
 * a loop announces itself by frequency long before anyone reads a reason.
 */

/** More runs than this in the window means something is looping, not working. */
export const RUNAWAY_RUNS = 12;
export const RUNAWAY_WINDOW_MIN = 10;
/** A run that fails faster than this did not do any work. */
export const INSTANT_FAILURE_MS = 5_000;

export type Runaway = { tripped: true; reason: string } | { tripped: false };

/**
 * Real work is slow: a build takes minutes. A dozen runs in ten minutes is a
 * machine spinning, and the honest response is to stop and say so rather than
 * keep paying for it.
 */
export function checkRate(recentRuns: number): Runaway {
  return recentRuns >= RUNAWAY_RUNS
    ? { tripped: true, reason: `${recentRuns} runs in the last ${RUNAWAY_WINDOW_MIN} minutes` }
    : { tripped: false };
}

/**
 * How long to wait after a failure before claiming anything again. A failure
 * that took no time at all is a failure that will repeat instantly, so the
 * backoff grows with each one: 5s, 20s, 45s, 80s, capped at five minutes.
 */
export function backoffMs(consecutiveInstantFailures: number): number {
  if (consecutiveInstantFailures <= 0) return 0;
  return Math.min(5 * 60_000, 5_000 * consecutiveInstantFailures ** 2);
}

export function wasInstant(startedAt: Date, endedAt: Date): boolean {
  return endedAt.getTime() - startedAt.getTime() < INSTANT_FAILURE_MS;
}
