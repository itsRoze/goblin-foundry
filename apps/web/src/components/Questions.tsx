import { useState } from 'react';
import { api } from '../api.ts';
import { groupByPhase } from '../inbox.ts';

export type QuestionCard = {
  id: string;
  phaseId: string;
  header: string;
  prompt: string;
  options: readonly { label: string; description: string }[];
  multiSelect: boolean;
  askedAt: number;
  answer?: string | null;
  answeredAt?: number | null;
};

/**
 * The other half of a grill round: a parked phase is sitting on these, and the
 * answers are what let it carry on. A round is answered as a round — clicking
 * an option picks it, and nothing is sent until you send it, because the agent
 * asked all four together and is waiting for all four. Rounds are grouped by
 * groupByPhase() — the one definition of "a round" — not by asked-at, which
 * could split one round or merge two.
 */
export function Questions({ questions, title = 'The goblin needs you', onSent }: {
  questions: QuestionCard[];
  title?: string;
  /** Fires once a round sends successfully, with the count and a short excerpt of what was sent. */
  onSent?: (count: number, excerpt: string) => void;
}) {
  const open = questions.filter(q => !q.answeredAt);
  if (!open.length) return null;
  return (
    <>
      {groupByPhase(open).map(round => (
        <Round key={round[0]!.phaseId} round={[...round].sort((a, b) => a.askedAt - b.askedAt)} title={title} onSent={onSent} />
      ))}
    </>
  );
}

function Round({ round, title, onSent }: { round: QuestionCard[]; title: string; onSent?: (count: number, excerpt: string) => void }) {
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const answerFor = (q: QuestionCard) => (typed[q.id]?.trim() || (picked[q.id] ?? []).join(', '));
  const answered = round.filter(q => answerFor(q));

  const send = async () => {
    if (answered.length < round.length || busy) return;
    setBusy(true);
    setError('');
    try {
      const answers = round.map(q => ({ questionId: q.id, answer: answerFor(q) }));
      await api.answerRound(round[0]!.phaseId, answers);
      onSent?.(round.length, answerFor(round[0]!));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const pick = (q: QuestionCard, label: string) => {
    setPicked(p => {
      const current = p[q.id] ?? [];
      if (!q.multiSelect) return { ...p, [q.id]: current.includes(label) ? [] : [label] };
      return { ...p, [q.id]: current.includes(label) ? current.filter(l => l !== label) : [...current, label] };
    });
  };

  return (
    <div className="panel asks">
      <div className="asks-head">
        <span className="pill human">awaiting input</span>
        <strong>{title}</strong>
        <span className="mono round-count">{answered.length}/{round.length} answered</span>
      </div>

      {round.map(q => {
        const overridden = Boolean(typed[q.id]?.trim());
        return (
          <div className="ask" key={q.id}>
            {q.header && <div className="ask-header mono">{q.header}{q.multiSelect ? ' · pick any' : ''}</div>}
            <div className="ask-prompt">{q.prompt}</div>
            <div className="ask-options">
              {q.options.map(o => (
                <button
                  key={o.label}
                  className={`btn ghost${(picked[q.id] ?? []).includes(o.label) && !overridden ? ' picked' : ''}`}
                  disabled={busy}
                  onClick={() => pick(q, o.label)}
                >
                  {o.label}
                  {o.description && <span className="ask-desc">{o.description}</span>}
                </button>
              ))}
            </div>
            <input
              placeholder={q.options.length ? 'Something else…' : 'Your answer…'}
              value={typed[q.id] ?? ''}
              disabled={busy}
              onChange={e => setTyped(t => ({ ...t, [q.id]: e.target.value }))}
            />
            {overridden && (picked[q.id] ?? []).length > 0 && (
              <div className="ask-desc">typed answer will be sent instead of {(picked[q.id] ?? []).join(', ')}</div>
            )}
          </div>
        );
      })}

      <div className="asks-foot">
        {error && <span className="ask-error">{error}</span>}
        <button className="btn" disabled={busy || answered.length < round.length} onClick={() => void send()}>
          {busy ? 'Sending…'
            : answered.length < round.length ? `${round.length - answered.length} still to answer`
            : `Send ${round.length > 1 ? `${round.length} answers` : 'answer'}`}
        </button>
      </div>
    </div>
  );
}
