import { useEffect, useState } from 'react';
import { ticketBranchName, type Ticket } from '@goblin/shared';

/** Buttons and palette commands share clipboard behavior and truthful feedback. */
export function useBranchCopy(ticket?: Pick<Ticket, 'key' | 'title'>) {
  const branch = ticket ? ticketBranchName(ticket) : '';
  const [copied, setCopied] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = async () => {
    if (!branch) return;
    setFailed(null);
    setCopied(null);
    try {
      await navigator.clipboard.writeText(branch);
      setCopied(branch);
    } catch {
      setFailed(branch);
    }
  };
  return { branch, copied: copied === branch, failed: failed === branch, copy };
}
