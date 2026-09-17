import { useCallback, useState } from 'react';
import { useKey } from '../keys';
import { useRestore, useTrash, type TrashKind } from '../queries';
import { useCrumb } from '../shell';
import { Empty, Kbd, Tile, refusalLine, when } from '../ui';

interface Recoverable {
  id: number;
  label: string;
  trashed_at: string | null;
}

/** Everything recoverable, one tile per kind, newest first; `r` restores the first row of the focused tile. */
export function TrashPage() {
  useCrumb('trash');
  const trash = useTrash();
  const restore = useRestore();
  const [refusal, setRefusal] = useState<string | null>(null);

  const doRestore = async (kind: TrashKind, id: number) => {
    setRefusal(null);
    try {
      await restore.mutateAsync({ kind, id });
    } catch (e) {
      setRefusal(refusalLine(e));
    }
  };

  useKey(
    'r',
    useCallback(() => {
      // the row you are standing on, else the first in the focused tile, else the first on the page
      const row =
        document.activeElement?.closest<HTMLElement>('[data-trash-row]') ??
        document.querySelector<HTMLElement>('.gf-tile.is-focus [data-trash-row]') ??
        document.querySelector<HTMLElement>('[data-trash-row]');
      row?.querySelector<HTMLButtonElement>('button')?.click();
    }, []),
  );

  const byNewest = (rows: Recoverable[]) => [...rows].sort((a, b) => (b.trashed_at ?? '').localeCompare(a.trashed_at ?? ''));

  return (
    <>
      {refusal && (
        <p className="gf-refusal" role="alert">
          {refusal}
        </p>
      )}
      <TrashTile
        kind="app"
        loaded={trash.data !== undefined}
        rows={byNewest((trash.data?.apps ?? []).map((a) => ({ id: a.id, label: a.name, trashed_at: a.trashed_at })))}
        onRestore={doRestore}
      />
      <TrashTile
        kind="project"
        loaded={trash.data !== undefined}
        rows={byNewest((trash.data?.projects ?? []).map((p) => ({ id: p.id, label: p.name, trashed_at: p.trashed_at })))}
        onRestore={doRestore}
      />
      <TrashTile
        kind="ticket"
        loaded={trash.data !== undefined}
        rows={byNewest((trash.data?.tickets ?? []).map((t) => ({ id: t.id, label: `${t.key} ${t.title}`, trashed_at: t.trashed_at })))}
        onRestore={doRestore}
      />
    </>
  );
}

function TrashTile({
  kind,
  rows,
  loaded,
  onRestore,
}: {
  kind: TrashKind;
  rows: Recoverable[];
  loaded: boolean;
  onRestore: (kind: TrashKind, id: number) => Promise<void>;
}) {
  return (
    <Tile
      label={`${kind}s`}
      subtitle={loaded ? String(rows.length) : undefined}
      keys={
        <>
          <Kbd>r</Kbd> restore
        </>
      }
      testId={`trash-${kind}s-tile`}
    >
      {loaded && rows.length === 0 && <Empty>no {kind}s in the trash</Empty>}
      <div className="gf-rows">
        {rows.map((it) => (
          <div key={it.id} className="gf-row" data-trash-row data-testid={`trash-${kind}-${it.id}`}>
            <span className="gf-row-title">{it.label}</span>
            <span className="gf-row-meta">trashed {it.trashed_at ? when(it.trashed_at) : ''}</span>
            <span className="gf-row-trail">
              <button className="gf-btn" onClick={() => void onRestore(kind, it.id)}>
                restore
              </button>
            </span>
          </div>
        ))}
      </div>
    </Tile>
  );
}
