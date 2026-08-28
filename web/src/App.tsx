import { useEffect, useState } from 'react';
import { SettingsSchema, type Settings } from '@goblin/shared';

type State = { kind: 'loading' } | { kind: 'ok'; settings: Settings } | { kind: 'error'; message: string };

export function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let live = true;
    fetch('/api/settings')
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return SettingsSchema.parse(await r.json());
      })
      .then((settings) => live && setState({ kind: 'ok', settings }))
      .catch((e: unknown) => live && setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) }));
    return () => {
      live = false;
    };
  }, []);

  return (
    <>
      <header className="gf-status">
        <strong>goblin foundry</strong>
        <span>S1 · tracker</span>
      </header>
      <main className="gf-main">
        <section className="gf-tile" aria-labelledby="settings-title">
          <div className="gf-tile-head" id="settings-title">settings</div>
          <div className="gf-tile-body">
            {state.kind === 'loading' && <p>loading…</p>}
            {state.kind === 'error' && <p className="gf-err">could not reach the API: {state.message}</p>}
            {state.kind === 'ok' && (
              <dl className="gf-kv">
                <dt>ticket prefix</dt>
                <dd data-testid="ticket-prefix">{state.settings.ticket_prefix}</dd>
              </dl>
            )}
          </div>
        </section>
      </main>
    </>
  );
}
