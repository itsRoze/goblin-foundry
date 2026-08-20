const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:4848';
const TOKEN = import.meta.env.VITE_FOUNDRY_TOKEN ?? '';

async function post(path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

export const api = {
  moveTicket: (ticketId: string, kind: string) => post(`/api/tickets/${ticketId}/status`, { kind }),
  approveDesign: (designId: string) => post(`/api/designs/${designId}/approve`),
  rejectDesign: (designId: string, note: string) => post(`/api/designs/${designId}/reject`, { note }),
  answerQuestion: (questionId: string, answer: string) =>
    post(`/api/questions/${questionId}/answer`, { answer }),
  eventStream: (runId: string, cursor = '0') =>
    new EventSource(`${BASE}/api/runs/${runId}/stream?cursor=${cursor}&token=${encodeURIComponent(TOKEN)}`),
};
