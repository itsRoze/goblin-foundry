import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@rocicorp/zero/react';
import { queries } from '@goblin/schema/queries';
import { href } from '../router.ts';
import { api } from '../api.ts';
import { clock, duration, usd } from '../format.ts';

type Event = {
  id: string; run_id: string; phase_id: string | null; type: string; name: string;
  payload: Record<string, unknown>; started_at: string; ended_at: string | null;
};

/** Live tail. The same cursor query replays history first, so a finished run
    renders identically to a running one. */
function useEvents(runId: string): Event[] {
  const [events, setEvents] = useState<Event[]>([]);
  useEffect(() => {
    setEvents([]);
    const source = api.eventStream(runId);
    source.addEventListener('event', e => {
      const event = JSON.parse((e as MessageEvent).data) as Event;
      setEvents(prev => (prev.some(p => p.id === event.id) ? prev : [...prev, event]));
    });
    return () => source.close();
  }, [runId]);
  return events;
}

export function Trace({ runId }: { runId: string }) {
  const [runs] = useQuery(useMemo(() => queries.run({ runId }), [runId]));
  const run = runs[0];
  const events = useEvents(runId);
  const [selected, setSelected] = useState<string | null>(null);

  const [t0, t1] = useMemo(() => {
    const times = events.flatMap(e => [Date.parse(e.started_at), e.ended_at ? Date.parse(e.ended_at) : 0])
      .filter(Boolean);
    const start = run ? run.startedAt : Math.min(...times, Date.now());
    const end = run?.endedAt ?? Math.max(Date.now(), ...times);
    return [start, Math.max(end, start + 1000)];
  }, [run, events]);

  if (!run) return <div className="page">Loading run…</div>;
  const pct = (t: number) => `${Math.min(100, Math.max(0, ((t - t0) / (t1 - t0)) * 100))}%`;
  const phase = run.phases.find(p => p.id === selected);

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <div className="mono" style={{ color: 'var(--muted)', fontSize: 12 }}>{run.id}</div>
      <h2 style={{ fontSize: 26, margin: '2px 0 8px' }}>
        {run.ticket ? <a href={href.ticket(run.ticket.shortId)}>FAC-{run.ticket.shortId} · {run.ticket.title}</a> : 'Run'}
      </h2>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        <span className={`pill ${run.status === 'fail' ? 'bad' : run.status === 'success' ? 'ok' : 'code'}`}>{run.status}</span>
        {run.terminalReason && <span className="pill">{run.terminalReason}</span>}
        <span className="pill">{run.branch ?? 'no branch'}</span>
        <span className="pill" title="Client-side estimate at API list prices. On a subscription, runs draw down plan windows, not dollars.">{usd(run.costUsd)} est.</span>
        <span className="pill">{duration((run.endedAt ?? Date.now()) - run.startedAt)}</span>
        <span className="pill">{events.length} events</span>
      </div>

      <div className="lanes">
        {run.phases.map(p => {
          const mine = events.filter(e => e.phase_id === p.id);
          return (
            <div className="lane" key={p.id}>
              <div className="who" onClick={() => setSelected(p.id)}>
                <div className="name">{p.name}</div>
                <div className="sub">{p.kind}{p.model ? ` · ${p.model}` : ''}</div>
                <div className="sub">{p.status} · {usd(p.costUsd)}</div>
              </div>
              <div className="track">
                {mine.filter(e => e.ended_at).map(e => {
                  const start = Date.parse(e.started_at);
                  const end = Date.parse(e.ended_at!);
                  return (
                    <div
                      key={e.id}
                      className={`span${e.payload?.ok === false ? ' bad' : ''}`}
                      style={{ left: pct(start), width: `calc(${pct(end)} - ${pct(start)})` }}
                      title={`${e.name} · ${duration(end - start)}`}
                    >{e.name}</div>
                  );
                })}
                {mine.filter(e => !e.ended_at).map(e => (
                  <div key={e.id} className={`tick ${e.type}`} style={{ left: pct(Date.parse(e.started_at)) }}
                       title={`${e.type}: ${e.name}`} />
                ))}
              </div>
            </div>
          );
        })}
        {!run.phases.length && <div style={{ padding: 14, color: 'var(--muted)' }}>No phases yet.</div>}
      </div>

      {phase && (
        <div className="panel" style={{ marginTop: 14 }}>
          <h3 style={{ fontSize: 18, marginBottom: 8 }}>{phase.name} · attempt {phase.attempt}</h3>
          <dl className="kv">
            <dt>model</dt><dd>{phase.model ?? '—'} {phase.effort ? `· ${phase.effort}` : ''}</dd>
            <dt>session</dt><dd className="mono">{phase.sessionId ?? '—'}</dd>
            <dt>cost (est.)</dt><dd>{usd(phase.costUsd)} · {phase.inputTokens} in / {phase.outputTokens} out / {phase.cacheReadTokens} cached</dd>
            <dt>turns</dt><dd>{phase.numTurns}</dd>
            {phase.error && <><dt>error</dt><dd style={{ color: 'var(--bad)' }}>{phase.error}</dd></>}
          </dl>
          {phase.gates.map(g => (
            <div key={g.id} style={{ marginTop: 10 }}>
              <strong>{g.gate}</strong>{' '}
              <span className={`pill ${g.passed ? 'ok' : 'bad'}`}>{g.passed ? 'pass' : 'fail'}</span>
              <ul className="checks">
                {g.checks.map((c, i) => (
                  <li key={i}>{c.ok ? '✓' : '✗'} <code>{c.item}</code> — {c.note}</li>
                ))}
              </ul>
            </div>
          ))}
          {phase.envelopes.map(e => (
            <details key={e.id} style={{ marginTop: 10 }}>
              <summary>{e.outputType} {e.valid ? '' : '(invalid)'} · attempt {e.attempt}</summary>
              <pre className="mono" style={{ fontSize: 12, overflowX: 'auto' }}>
                {JSON.stringify(e.payload, null, 2)}
              </pre>
            </details>
          ))}
        </div>
      )}

      <h3 style={{ margin: '18px 0 8px', fontSize: 18 }}>Event feed</h3>
      <div className="panel feed">
        {events.map(e => (
          <div className="row" key={e.id}>
            <span className="t">{clock(Date.parse(e.started_at))}</span>
            <span className="ty">{e.type}</span>
            <span>{e.name}</span>
          </div>
        ))}
        {!events.length && <div style={{ color: 'var(--muted)' }}>Waiting for events…</div>}
      </div>
    </div>
  );
}
