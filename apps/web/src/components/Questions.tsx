import { useState } from 'react';
import { api } from '../api.ts';

export type QuestionCard = {
  id: string;
  header: string;
  prompt: string;
  options: readonly { label: string; description: string }[];
  multiSelect: boolean;
  answer?: string | null;
  answeredAt?: number | null;
};

/**
 * The other half of a grill round: a parked phase is sitting on these, and the
 * answer is what lets it carry on. Options are one-click; "Something else" is
 * always available, because the agent's four choices are not the whole world.
 */
export function Questions({ questions, title = 'The goblin needs you' }: {
  questions: QuestionCard[];
  title?: string;
}) {
  const open = questions.filter(q => !q.answeredAt);
  if (!open.length) return null;
  return (
    <div className="panel asks">
      <div className="asks-head">
        <span className="pill human">awaiting input</span>
        <strong>{title}</strong>
      </div>
      {open.map(q => <Question key={q.id} q={q} />)}
    </div>
  );
}

function Question({ q }: { q: QuestionCard }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const send = async (answer: string) => {
    if (!answer.trim() || busy) return;
    setBusy(true);
    setError('');
    try { await api.answerQuestion(q.id, answer.trim()); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  };

  const toggle = (label: string) => {
    if (!q.multiSelect) { void send(label); return; }
    setPicked(p => (p.includes(label) ? p.filter(l => l !== label) : [...p, label]));
  };

  return (
    <div className="ask">
      {q.header && <div className="ask-header mono">{q.header}</div>}
      <div className="ask-prompt">{q.prompt}</div>
      <div className="ask-options">
        {q.options.map(o => (
          <button
            key={o.label}
            className={`btn ghost${picked.includes(o.label) ? ' picked' : ''}`}
            disabled={busy}
            title={o.description}
            onClick={() => toggle(o.label)}
          >
            {o.label}
            {o.description && <span className="ask-desc">{o.description}</span>}
          </button>
        ))}
      </div>
      <div className="ask-other">
        <input
          placeholder={q.options.length ? 'Something else…' : 'Your answer…'}
          value={other}
          disabled={busy}
          onChange={e => setOther(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void send(other); }}
        />
        <button
          className="btn"
          disabled={busy || (!other.trim() && !picked.length)}
          onClick={() => void send(other.trim() || picked.join(', '))}
        >
          {busy ? 'Sending…' : 'Answer'}
        </button>
      </div>
      {error && <div className="ask-error">{error}</div>}
    </div>
  );
}
