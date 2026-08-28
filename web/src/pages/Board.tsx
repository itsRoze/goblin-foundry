import { useSettings } from '../queries';
import { useCrumb } from '../shell';
import { Empty, Kv, Tile } from '../ui';

/** The kanban arrives with issue 03; until then the board shows the installation. */
export function BoardPage() {
  useCrumb('board');
  const settings = useSettings();
  return (
    <Tile label="settings" focus>
      {settings.isError && <p className="gf-refusal">could not reach the API: {settings.error.message}</p>}
      {settings.data ? <Kv rows={[['ticket prefix', <span data-testid="ticket-prefix">{settings.data.ticket_prefix}</span>]]} /> : !settings.isError && <Empty>loading…</Empty>}
    </Tile>
  );
}
