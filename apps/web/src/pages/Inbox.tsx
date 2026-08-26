import { useMemo, useState } from 'react';
import { formatRef } from '@goblin/schema';
import { href } from '../router.ts';
import { ago, usd } from '../format.ts';
import { api } from '../api.ts';
import { useInboxSections, useMissingItemTicket } from '../useInbox.ts';
import { isStale, type Approval, type Round, type Stuck } from '../inbox.ts';
import { Questions, type QuestionCard } from '../components/Questions.tsx';
import { Design, type DesignRecord } from '../components/Design.tsx';

type Item = Round | Approval | Stuck;
type Handled = { id: string; label: string };

/**
 * Everything waiting on the operator, across every project, in one list.
 * Sections are pure display of apps/web/src/inbox.ts's derivation; every
 * action goes through the shared Questions/Design components or the stuck
 * item's own retry/backlog controls, each one request per apps/api/src/db.ts's
 * one-transaction endpoints.
 */
export function Inbox({ itemId }: { itemId?: string }) {
  const { sections, loading } = useInboxSections();
  const missingTicket = useMissingItemTicket(itemId);
  const [staleOpen, setStaleOpen] = useState(false);
  const [handled, setHandled] = useState<Handled[]>([]);
  const handledIds = useMemo(() => new Set(handled.map(h => h.id)), [handled]);

  const close = () => { location.hash = href.inbox; };
  const markHandled = (id: string, label: string) => {
    setHandled(h => [{ id, label }, ...h]);
    close();
  };

  if (loading) {
    return (
      <div className="page inbox">
        <h2 style={{ fontSize: 28, margin: '2px 0 8px' }}>Inbox</h2>
        <div className="panel muted">Loading…</div>
      </div>
    );
  }

  const blocking = sections.blocking.filter(r => !handledIds.has(r.id));
  const waiting = sections.waiting.filter(a => !handledIds.has(a.id));
  const stuck = sections.stuck.filter(s => !handledIds.has(s.id));
  const stale = sections.stale.filter(r => !handledIds.has(r.id));
  const total = blocking.length + waiting.length + stuck.length + stale.length;

  const all: Item[] = [...blocking, ...waiting, ...stuck, ...stale];
  const expanded = itemId ? all.find(i => i.id === itemId) : undefined;
  const missing = Boolean(itemId) && !expanded && !handledIds.has(itemId!);
  const open = (id: string) => { location.hash = href.inboxItem(id); };

  return (
    <div className="page inbox">
      <h2 style={{ fontSize: 28, margin: '2px 0 8px' }}>Inbox</h2>

      {missing && (
        <div className="panel muted" style={{ marginBottom: 12 }}>
          That item is no longer waiting.
          {missingTicket && (
            <> <a href={href.ticket(missingTicket.key, missingTicket.shortId)}>
              Open {formatRef(missingTicket.key, missingTicket.shortId)} · {missingTicket.title}
            </a></>
          )}
        </div>
      )}

      {total === 0 && (
        <div className="panel">
          <p>Nothing needs you.</p>
          <a className="btn ghost" href={href.board}>Back to the board</a>
        </div>
      )}

      {total > 0 && (
        <>
          {blocking.length > 0 && (
            <section className="inbox-section">
              <h3>Blocking a run <span className="count">{blocking.length}</span></h3>
              {blocking.map(r => <RoundRow key={r.id} round={r} onOpen={open} />)}
            </section>
          )}

          {waiting.length > 0 && (
            <section className="inbox-section">
              <h3>Waiting <span className="count">{waiting.length}</span></h3>
              {waiting.map(a => <ApprovalRow key={a.id} approval={a} onOpen={open} />)}
            </section>
          )}

          {stuck.length > 0 && (
            <section className="inbox-section">
              <h3>Stuck <span className="count">{stuck.length}</span></h3>
              {stuck.map(s => <StuckRow key={s.id} stuck={s} onOpen={open} />)}
            </section>
          )}

          {stale.length > 0 && (
            <section className="inbox-section">
              <button className="inbox-section-head" onClick={() => setStaleOpen(o => !o)}>
                <h3>Stale <span className="count">{stale.length}</span></h3>
                <span className="mono muted">{staleOpen ? 'hide' : 'show'}</span>
              </button>
              {staleOpen && stale.map(r => <RoundRow key={r.id} round={r} stale onOpen={open} />)}
            </section>
          )}
        </>
      )}

      {handled.length > 0 && (
        <section className="inbox-section">
          <h3>Handled just now <span className="count">{handled.length}</span></h3>
          {handled.map(h => (
            <div key={h.id} className="inbox-row handled">{h.label}</div>
          ))}
        </section>
      )}

      {expanded && (
        <div className="inbox-expanded">
          <div className="inbox-expanded-top">
            <button className="btn ghost" onClick={close}>← Back</button>
            <span className="mono">{expanded.ticketRef}</span>
            <span className="spacer" />
          </div>
          <div className={`inbox-expanded-body${expanded.kind === 'approval' ? ' has-frame' : ''}`}>
            {expanded.kind === 'round' && !isStale(expanded) && <RoundDetail round={expanded} onHandled={markHandled} />}
            {expanded.kind === 'round' && isStale(expanded) && <StaleRoundDetail round={expanded} onHandled={markHandled} />}
            {expanded.kind === 'approval' && <ApprovalDetail approval={expanded} onHandled={markHandled} />}
            {expanded.kind === 'stuck' && <StuckDetail stuck={expanded} onHandled={markHandled} />}
          </div>
        </div>
      )}
    </div>
  );
}

function excerpt(html: string): string {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > 140 ? `${text.slice(0, 140)}…` : text;
}

function RoundRow({ round, stale, onOpen }: { round: Round; stale?: boolean; onOpen: (id: string) => void }) {
  const now = Date.now();
  return (
    <button className={`inbox-row${stale ? ' stale' : ''}`} onClick={() => onOpen(round.id)}>
      <div className="inbox-row-top">
        <span className="mono id">{round.ticketRef}</span>
        <span className="pill">{round.projectKey}</span>
        {round.agent && <span className="pill agent">{round.agent}</span>}
        <span className="spacer" />
        <span className="mono age">{stale ? 'run ended' : `parked ${ago(round.parkedAtMs, now)}`}</span>
      </div>
      <div className="title">{round.ticketTitle}</div>
      <div className="inbox-row-sub">
        {round.questions.length} question{round.questions.length === 1 ? '' : 's'} · {round.firstUnanswered.header}
      </div>
      <div className="inbox-row-foot">
        <span className="mono">{usd(round.costUsd)} spent</span>
        {stale && <span className="muted">This run has ended — answering would reach nobody.</span>}
      </div>
    </button>
  );
}

function ApprovalRow({ approval, onOpen }: { approval: Approval; onOpen: (id: string) => void }) {
  const now = Date.now();
  return (
    <button className="inbox-row" onClick={() => onOpen(approval.id)}>
      <div className="inbox-row-top">
        <span className="mono id">{approval.ticketRef}</span>
        <span className="pill">{approval.projectKey}</span>
        <span className="pill code">v{approval.version}</span>
        <span className="spacer" />
        <span className="mono age">submitted {ago(approval.submittedAtMs, now)} ago</span>
      </div>
      <div className="title">{approval.ticketTitle}</div>
      <div className="inbox-row-sub">{excerpt(approval.reviewHtml || approval.markdown)}</div>
      {approval.notes.length > 0 && (
        <div className="inbox-row-foot">
          <span className="mono">{approval.notes.length} note{approval.notes.length === 1 ? '' : 's'}</span>
        </div>
      )}
    </button>
  );
}

function StuckRow({ stuck, onOpen }: { stuck: Stuck; onOpen: (id: string) => void }) {
  const now = Date.now();
  return (
    <button className="inbox-row" onClick={() => onOpen(stuck.id)}>
      <div className="inbox-row-top">
        <span className="mono id">{stuck.ticketRef}</span>
        <span className="pill">{stuck.projectKey}</span>
        <span className="pill bad">{stuck.terminalReason}</span>
        <span className="spacer" />
        <span className="mono age">{ago(stuck.endedAt, now)} ago</span>
      </div>
      <div className="title">{stuck.ticketTitle}</div>
      <div className="inbox-row-sub">{usd(stuck.costUsd)} spent · returns to {stuck.returnsToName}</div>
    </button>
  );
}

function toQuestionCards(round: Round): QuestionCard[] {
  return round.questions.map(q => ({
    id: q.id,
    phaseId: q.phaseId,
    header: q.header,
    prompt: q.prompt ?? '',
    options: q.options ?? [],
    multiSelect: q.multiSelect ?? false,
    askedAt: q.askedAt,
    answeredAt: q.answeredAt ?? null,
  }));
}

function RoundDetail({ round, onHandled }: { round: Round; onHandled: (id: string, label: string) => void }) {
  return (
    <Questions
      questions={toQuestionCards(round)}
      title={`${round.agent || 'A goblin'} needs you`}
      onSent={(count, sentExcerpt) =>
        onHandled(round.id, `${round.ticketRef} · answered ${count} · "${sentExcerpt.slice(0, 40)}"`)}
    />
  );
}

function StaleRoundDetail({ round, onHandled }: { round: Round; onHandled: (id: string, label: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const dismiss = async () => {
    setBusy(true);
    setError('');
    try {
      await api.dismissRound(round.phaseId);
      onHandled(round.id, `${round.ticketRef} · dismissed`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="panel asks stale">
      <div className="asks-head">
        <span className="pill bad">run ended</span>
        <strong>Answering this round would reach nobody</strong>
      </div>
      {round.questions.map(q => (
        <div className="ask" key={q.id}>
          {q.header && <div className="ask-header mono">{q.header}</div>}
          <div className="ask-prompt">{q.prompt}</div>
        </div>
      ))}
      {error && <div className="ask-error">{error}</div>}
      <div className="asks-foot">
        <button className="btn ghost" disabled={busy} onClick={() => void dismiss()}>Dismiss</button>
      </div>
    </div>
  );
}

function toDesignRecord(approval: Approval): DesignRecord {
  return {
    id: approval.designId, version: approval.version, status: approval.status,
    markdown: approval.markdown, reviewHtml: approval.reviewHtml, notes: approval.notes,
  };
}

function ApprovalDetail({ approval, onHandled }: { approval: Approval; onHandled: (id: string, label: string) => void }) {
  return (
    <Design
      design={toDesignRecord(approval)}
      onDecided={(outcome, note) => onHandled(
        approval.id,
        outcome === 'approved'
          ? `${approval.ticketRef} · approved v${approval.version}`
          : `${approval.ticketRef} · sent back · "${note.slice(0, 40)}"`,
      )}
    />
  );
}

function StuckDetail({ stuck, onHandled }: { stuck: Stuck; onHandled: (id: string, label: string) => void }) {
  const [confirming, setConfirming] = useState<'retry' | 'backlog' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const act = async (action: 'retry' | 'backlog') => {
    setBusy(true);
    setError('');
    try {
      if (action === 'retry') {
        const res = await api.retryTicket(stuck.ticketId) as { requeued: boolean };
        onHandled(stuck.id, `${stuck.ticketRef} · ${res.requeued ? 're-queued' : `sent back to ${stuck.returnsToName}`}`);
      } else {
        await api.backlogTicket(stuck.ticketId);
        onHandled(stuck.id, `${stuck.ticketRef} · sent to backlog`);
      }
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
      setConfirming(null);
    }
  };

  return (
    <div className="panel">
      <dl className="kv">
        <dt>Terminal reason</dt><dd>{stuck.terminalReason}</dd>
        <dt>Spent</dt><dd>{usd(stuck.costUsd)}</dd>
        <dt>Returns to</dt><dd>{stuck.returnsToName}</dd>
      </dl>
      <a className="btn ghost" href={href.run(stuck.runId)}>View run trace</a>

      {error && <div className="ask-error" style={{ marginTop: 10 }}>{error}</div>}

      <div className="asks-foot" style={{ justifyContent: 'flex-start', marginTop: 14, borderTop: 'none', paddingTop: 0 }}>
        {confirming === 'retry' ? (
          <>
            <span className="muted">Start a new run? · last run {usd(stuck.costUsd)}</span>
            <button className="btn" disabled={busy} onClick={() => void act('retry')}>Confirm</button>
            <button className="btn ghost" disabled={busy} onClick={() => setConfirming(null)}>Cancel</button>
          </>
        ) : confirming === 'backlog' ? (
          <>
            <span className="muted">Send to backlog and stop retrying?</span>
            <button className="btn" disabled={busy} onClick={() => void act('backlog')}>Confirm</button>
            <button className="btn ghost" disabled={busy} onClick={() => setConfirming(null)}>Cancel</button>
          </>
        ) : (
          <>
            <button className="btn" disabled={busy} onClick={() => setConfirming('retry')}>Retry</button>
            <button className="btn ghost" disabled={busy} onClick={() => setConfirming('backlog')}>Send to backlog</button>
          </>
        )}
      </div>
    </div>
  );
}
