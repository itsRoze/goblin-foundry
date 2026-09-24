import { useState, type FormEvent, type RefObject } from 'react';
import { AddImplementationLinkBodySchema, type Ticket } from '@goblin/shared';
import { useImplementationLinks, useImplementationLinkWrites } from './queries';
import { useBulkLock } from './selecting';
import { Empty, Tile, refusalLine } from './ui';
import type { useBranchCopy } from './branch-copy';

export function ImplementationTile({ ticket, branchCopy, input }: {
  ticket: Ticket;
  branchCopy: ReturnType<typeof useBranchCopy>;
  input: RefObject<HTMLInputElement | null>;
}) {
  const { branch, copied, failed: copyError, copy } = branchCopy;
  const links = useImplementationLinks(ticket.key);
  const { add, remove } = useImplementationLinkWrites();
  const { guard } = useBulkLock(ticket);
  const [url, setUrl] = useState('');
  const [refusal, setRefusal] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const busy = add.isPending || remove.isPending;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setNotice('');
    const parsed = AddImplementationLinkBodySchema.safeParse({ url });
    if (!parsed.success) { setRefusal(parsed.error.issues[0]!.message); return; }
    setRefusal(null);
    try {
      await guard(() => add.mutateAsync({ key: ticket.key, url: parsed.data.url }));
      setUrl('');
      setNotice('link saved');
      input.current?.focus();
    } catch (error) { setRefusal(refusalLine(error)); }
  };
  const drop = async (id: number) => {
    setRefusal(null);
    setNotice('');
    try {
      await guard(() => remove.mutateAsync({ key: ticket.key, id }));
      setNotice('link removed');
      input.current?.focus();
    } catch (error) { setRefusal(refusalLine(error)); }
  };

  return (
    <Tile label="implementation" testId="implementation-tile">
      <div className="gf-branch">
        <code className="gf-branch-name" data-testid="branch-name">{branch}</code>
        <button type="button" className="gf-btn" aria-label="copy git branch name" onClick={() => void copy()}>{copied ? 'copied' : 'copy branch'}</button>
      </div>
      <span className="gf-implementation-notice" role="status">{copied ? 'branch name copied' : ''}</span>
      {copyError && <p className="gf-refusal" role="alert">Couldn’t copy. Select the branch name above and copy it manually.</p>}
      {links.isError ? <div className="gf-actions"><p className="gf-refusal" role="alert">Couldn’t load implementation links.</p><button className="gf-btn" type="button" onClick={() => void links.refetch()}>retry</button></div> : !links.data ? <Empty>loading links…</Empty> : links.data.length === 0 ? <Empty>no PR or commit linked yet</Empty> : (
        <ul className="gf-implementation-links">
          {links.data.map((link) => <li className="gf-implementation-row" key={link.id}>
            <a className="gf-implementation-url" href={link.url} target="_blank" rel="noopener noreferrer">{link.url}</a>
            <button type="button" className="gf-dep-drop" disabled={busy} aria-label={`remove ${link.url}`} onClick={() => void drop(link.id)}>×</button>
          </li>)}
        </ul>
      )}
      <form className="gf-implementation-form" onSubmit={(event) => void submit(event)}>
        <label className="gf-field"><span>PR / commit</span><input ref={input} aria-label="PR or commit URL" type="url" required maxLength={2048} placeholder="https://…" value={url} disabled={busy} onChange={(event) => { setUrl(event.target.value); setRefusal(null); setNotice(''); }} /></label>
        <button type="submit" className="gf-btn" disabled={busy || !url.trim()}>{add.isPending ? 'saving…' : 'add link'}</button>
      </form>
      {refusal && <p className="gf-refusal" role="alert">{refusal}</p>}
      <span className="gf-implementation-notice" role="status">{notice}</span>
    </Tile>
  );
}
