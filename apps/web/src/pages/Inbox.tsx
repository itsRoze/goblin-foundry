import { useState } from 'react';
import { marked } from 'marked';
import { href } from '../router.ts';
import { ago, usd } from '../format.ts';
import { useInboxSections } from '../useInbox.ts';
import type { Approval, Round, Stuck } from '../inbox.ts';

type Item = Round | Approval | Stuck;

/**
 * Everything waiting on the operator, across every project, in one list. This
 * slice is read-only: rows expand to show the thing they are, but answering a
 * round, approving a design and retrying a stuck ticket ship as the inbox's
 * next slice — see docs/design's sequencing.
 */
export function Inbox({ itemId }: { itemId?: string }) {
  const sections = useInboxSections();
  const [staleOpen, setStaleOpen] = useState(false);

  const all: Item[] = [...sections.blocking, ...sections.waiting, ...sections.stuck, ...sections.stale];
  const expanded = itemId ? all.find(i => i.id === itemId) : undefined;
  const missing = Boolean(itemId) && !expanded;
  const total = sections.blocking.length + sections.waiting.length + sections.stuck.length + sections.stale.length;

  const open = (id: string) => { location.hash = href.inboxItem(id); };
  const close = () => { location.hash = href.inbox; };

  return (
    <div className="page inbox">
      <h2 style={{ fontSize: 28, margin: '2px 0 8px' }}>Inbox</h2>

      {missing && <div className="panel muted" style={{ marginBottom: 12 }}>That item is no longer waiting.</div>}

      {total === 0 ? (
        <div className="panel">
          <p>Nothing needs you.</p>
          <a className="btn ghost" href={href.board}>Back to the board</a>
        </div>
      ) : (
        <>
          {sections.blocking.length > 0 && (
            <section className="inbox-section">
              <h3>Blocking a run <span className="count">{sections.blocking.length}</span></h3>
              {sections.blocking.map(r => <RoundRow key={r.id} round={r} onOpen={open} />)}
            </section>
          )}

          {sections.waiting.length > 0 && (
            <section className="inbox-section">
              <h3>Waiting <span className="count">{sections.waiting.length}</span></h3>
              {sections.waiting.map(a => <ApprovalRow key={a.id} approval={a} onOpen={open} />)}
            </section>
          )}

          {sections.stuck.length > 0 && (
            <section className="inbox-section">
              <h3>Stuck <span className="count">{sections.stuck.length}</span></h3>
              {sections.stuck.map(s => <StuckRow key={s.id} stuck={s} onOpen={open} />)}
            </section>
          )}

          {sections.stale.length > 0 && (
            <section className="inbox-section">
              <button className="inbox-section-head" onClick={() => setStaleOpen(o => !o)}>
                <h3>Stale <span className="count">{sections.stale.length}</span></h3>
                <span className="mono muted">{staleOpen ? 'hide' : 'show'}</span>
              </button>
              {staleOpen && sections.stale.map(r => <RoundRow key={r.id} round={r} stale onOpen={open} />)}
            </section>
          )}
        </>
      )}

      {expanded && (
        <div className="inbox-expanded">
          <div className="inbox-expanded-top">
            <button className="btn ghost" onClick={close}>← Back</button>
            <span className="mono">{expanded.ticketRef}</span>
            <span className="spacer" />
          </div>
          <div className="inbox-expanded-body">
            {expanded.kind === 'round' && <RoundDetail round={expanded} />}
            {expanded.kind === 'approval' && <ApprovalDetail approval={expanded} />}
            {expanded.kind === 'stuck' && <StuckDetail stuck={expanded} />}
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
      {approval.notesCount > 0 && (
        <div className="inbox-row-foot">
          <span className="mono">{approval.notesCount} note{approval.notesCount === 1 ? '' : 's'}</span>
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

function RoundDetail({ round }: { round: Round }) {
  return (
    <div className="panel asks">
      <div className="asks-head">
        <span className="pill human">awaiting input</span>
        <strong>{round.agent || 'A goblin'} needs you</strong>
        <span className="mono round-count">0/{round.questions.length} answered</span>
      </div>
      {round.questions.map(q => (
        <div className="ask" key={q.id}>
          {q.header && <div className="ask-header mono">{q.header}</div>}
          <div className="ask-prompt">{q.prompt}</div>
          {q.options && q.options.length > 0 && (
            <ul className="checks">
              {q.options.map(o => <li key={o.label}>{o.label}{o.description ? ` — ${o.description}` : ''}</li>)}
            </ul>
          )}
        </div>
      ))}
      <div className="muted" style={{ marginTop: 10 }}>Answering ships in the next slice — read-only for now.</div>
    </div>
  );
}

function ApprovalDetail({ approval }: { approval: Approval }) {
  return (
    <div className="panel">
      <div className="design-head">
        <strong>v{approval.version}</strong>
        <span className="pill human">in review</span>
      </div>
      {approval.reviewHtml
        ? <iframe className="review" title={`Design v${approval.version}`} sandbox="" srcDoc={approval.reviewHtml} />
        : <div className="md" dangerouslySetInnerHTML={{ __html: marked.parse(approval.markdown) as string }} />}
      <div className="muted" style={{ marginTop: 10 }}>Approve and send back ship in the next slice — read-only for now.</div>
    </div>
  );
}

function StuckDetail({ stuck }: { stuck: Stuck }) {
  return (
    <div className="panel">
      <dl className="kv">
        <dt>Terminal reason</dt><dd>{stuck.terminalReason}</dd>
        <dt>Spent</dt><dd>{usd(stuck.costUsd)}</dd>
        <dt>Returns to</dt><dd>{stuck.returnsToName}</dd>
      </dl>
      <a className="btn ghost" href={href.run(stuck.runId)}>View run trace</a>
      <div className="muted" style={{ marginTop: 10 }}>Retry and send to backlog ship in the next slice — read-only for now.</div>
    </div>
  );
}
