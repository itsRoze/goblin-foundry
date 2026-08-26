export const usd = (n: number) => (n >= 0.01 || n === 0 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`);

export const tokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k tok` : `${n} tok`);

/**
 * Both lanes authenticate with a subscription or plan seat, so a dollar figure
 * on a run is a list-price estimate of money nobody spent. Only billable spend
 * — real dollars on an api-key (or unresolved) phase — is worth showing as
 * money; everything else reads as tokens.
 */
export const spendOrTokens = (r: { billableUsd: number; inputTokens: number; outputTokens: number }) =>
  r.billableUsd > 0 ? usd(r.billableUsd) : tokens(r.inputTokens + r.outputTokens);

export const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function duration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  return `${m}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/** How long ago `sinceMs` was, in the coarse unit a triage row reads at a glance. */
export function ago(sinceMs: number, nowMs: number): string {
  const ms = Math.max(0, nowMs - sinceMs);
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`;
  return `${Math.round(ms / 86_400_000)}d`;
}
