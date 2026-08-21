export const usd = (n: number) => (n >= 0.01 || n === 0 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`);

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
