import { useCallback, useState } from 'react';
import { useSettings, usePatchSettings } from '../queries';
import { useCrumb } from '../shell';
import { useKey } from '../keys';
import { Empty, Hint, InlineForm, Kv, Tile } from '../ui';

/**
 * The installation itself. Changing the prefix changes every displayed key at
 * once and no ticket number — the number is the identity (ADR-0002). The
 * Worktree root is where a Start makes new folders; one already made stays put.
 */
export function SettingsPage() {
  useCrumb('settings');
  const settings = useSettings();
  const patch = usePatchSettings();
  const [editing, setEditing] = useState(false);
  const edit = useCallback(() => setEditing(true), []);
  useKey('e', edit);

  return (
    <Tile
      label="settings"
      keys={
        <>
          <Hint k="e" onClick={edit} testId="hint-edit">
            edit
          </Hint>
        </>
      }
      testId="settings-tile"
    >
      {settings.isError && <p className="gf-refusal">could not reach the API: {settings.error.message}</p>}
      {editing && settings.data ? (
        <InlineForm
          testId="settings-form"
          fields={[
            { name: 'ticket_prefix', label: 'ticket prefix', placeholder: 'GF' },
            { name: 'worktree_root', label: 'worktree root', placeholder: '~/.goblin/worktrees' },
          ]}
          initial={{ ticket_prefix: settings.data.ticket_prefix, worktree_root: settings.data.worktree_root }}
          submitLabel="save"
          onCancel={() => setEditing(false)}
          onSubmit={async (v) => {
            await patch.mutateAsync({ ticket_prefix: v.ticket_prefix ?? '', worktree_root: v.worktree_root ?? '' });
            setEditing(false);
          }}
        />
      ) : settings.data ? (
        <Kv
          rows={[
            ['ticket prefix', <span data-testid="ticket-prefix">{settings.data.ticket_prefix}</span>],
            ['worktree root', <span className="gf-path" data-testid="worktree-root">{settings.data.worktree_root}</span>],
          ]}
        />
      ) : (
        !settings.isError && <Empty>loading…</Empty>
      )}
      <p className="gf-empty">changing the prefix rewrites every displayed key; ticket numbers do not move. changing the worktree root moves no worktree already made.</p>
    </Tile>
  );
}
