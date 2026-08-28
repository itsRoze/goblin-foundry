import { useCallback, useRef, useState } from 'react';
import { ProblemError } from '../api';
import { useKey } from '../keys';
import { useRestore, useTrash } from '../queries';
import { useCrumb } from '../shell';
import { Empty, Kbd, Tile, when } from '../ui';

/** Everything recoverable, newest first; `r` restores the focused row (or the first). */
export function TrashPage() {
  useCrumb('trash');
  const trash = useTrash();
  const restore = useRestore();
  const [refusal, setRefusal] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);

  const items = [
    ...(trash.data?.apps ?? []).map((a) => ({ kind: 'app' as const, ...a })),
    ...(trash.data?.projects ?? []).map((p) => ({ kind: 'project' as const, ...p })),
  ].sort((a, b) => (b.trashed_at ?? '').localeCompare(a.trashed_at ?? ''));

  const doRestore = async (kind: 'app' | 'project', id: number) => {
    setRefusal(null);
    try {
      await restore.mutateAsync({ kind, id });
    } catch (e) {
      setRefusal(e instanceof ProblemError ? e.line : String(e));
    }
  };

  useKey(
    'r',
    useCallback(() => {
      const focused = document.activeElement?.closest<HTMLElement>('[data-trash-row]');
      const row = focused ?? list.current?.querySelector<HTMLElement>('[data-trash-row]');
      row?.querySelector<HTMLButtonElement>('button')?.click();
    }, []),
  );

  return (
    <Tile
      label="trash"
      subtitle={trash.data ? String(items.length) : undefined}
      keys={
        <>
          <Kbd>r</Kbd> restore
        </>
      }
      focus
      testId="trash-tile"
    >
      {items.length === 0 && trash.data && <Empty>the trash is empty</Empty>}
      {refusal && (
        <p className="gf-refusal" role="alert">
          {refusal}
        </p>
      )}
      <div className="gf-rows" ref={list}>
        {items.map((it) => (
          <div key={`${it.kind}-${it.id}`} className="gf-row" data-trash-row data-testid={`trash-${it.kind}-${it.id}`}>
            <span className="gf-row-title">
              <span className="gf-row-kind">{it.kind}</span> {it.name}
            </span>
            <span className="gf-row-meta">trashed {it.trashed_at ? when(it.trashed_at) : ''}</span>
            <span className="gf-row-trail">
              <button className="gf-btn" onClick={() => doRestore(it.kind, it.id)}>
                restore
              </button>
            </span>
          </div>
        ))}
      </div>
    </Tile>
  );
}
