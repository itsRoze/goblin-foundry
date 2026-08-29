import { useCallback, useState } from 'react';
import { useSettings, usePatchSettings } from '../queries';
import { useCrumb } from '../shell';
import { useKey } from '../keys';
import { Empty, InlineForm, Kbd, Kv, Tile } from '../ui';

/**
 * The installation itself. Changing the prefix changes every displayed key at
 * once and no ticket number — the number is the identity (ADR-0002).
 */
export function SettingsPage() {
  useCrumb('settings');
  const settings = useSettings();
  const patch = usePatchSettings();
  const [editing, setEditing] = useState(false);
  useKey('e', useCallback(() => setEditing(true), []));

  return (
    <Tile
      label="settings"
      keys={
        <>
          <Kbd>e</Kbd> edit
        </>
      }
      focus
      testId="settings-tile"
    >
      {settings.isError && <p className="gf-refusal">could not reach the API: {settings.error.message}</p>}
      {editing && settings.data ? (
        <InlineForm
          testId="settings-form"
          fields={[{ name: 'ticket_prefix', label: 'ticket prefix', placeholder: 'GF' }]}
          initial={{ ticket_prefix: settings.data.ticket_prefix }}
          submitLabel="save"
          onCancel={() => setEditing(false)}
          onSubmit={async (v) => {
            await patch.mutateAsync({ ticket_prefix: v.ticket_prefix ?? '' });
            setEditing(false);
          }}
        />
      ) : settings.data ? (
        <Kv rows={[['ticket prefix', <span data-testid="ticket-prefix">{settings.data.ticket_prefix}</span>]]} />
      ) : (
        !settings.isError && <Empty>loading…</Empty>
      )}
      <p className="gf-empty">changing the prefix rewrites every displayed key; ticket numbers do not move.</p>
    </Tile>
  );
}
