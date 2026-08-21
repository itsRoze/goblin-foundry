const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:4848';
const TOKEN = import.meta.env.VITE_FOUNDRY_TOKEN ?? '';

async function post(path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    // The API's conflict responses ({error: "..."}) are written as sentences
    // for exactly this — surface that text, not a raw status-plus-body blob.
    const text = await res.text();
    const parsed = (() => { try { return JSON.parse(text) as { error?: string }; } catch { return null; } })();
    throw new Error(parsed?.error || `${path}: ${res.status} ${text}`);
  }
  return res.json();
}

export const api = {
  moveTicket: (ticketId: string, kind: string) => post(`/api/tickets/${ticketId}/status`, { kind }),
  approveDesign: (designId: string) => post(`/api/designs/${designId}/approve`),
  rejectDesign: (designId: string, note: string) => post(`/api/designs/${designId}/reject`, { note }),
  annotateDesign: (designId: string, note: string) =>
    post(`/api/designs/${designId}/notes`, { note }),
  answerQuestion: (questionId: string, answer: string) =>
    post(`/api/questions/${questionId}/answer`, { answer }),
  /** Every answer in a round, in one request recorded as one transaction. */
  answerRound: (phaseId: string, answers: { questionId: string; answer: string }[]) =>
    post(`/api/rounds/${phaseId}/answer`, { answers }),
  dismissRound: (phaseId: string) => post(`/api/rounds/${phaseId}/dismiss`, {}),
  retryTicket: (ticketId: string) => post(`/api/tickets/${ticketId}/retry`, {}),
  backlogTicket: (ticketId: string) => post(`/api/tickets/${ticketId}/backlog`, {}),
  eventStream: (runId: string, cursor = '0') =>
    new EventSource(`${BASE}/api/runs/${runId}/stream?cursor=${cursor}&token=${encodeURIComponent(TOKEN)}`),
};
