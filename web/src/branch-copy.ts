import { useEffect, useState } from 'react';
import { ticketBranchName, type Ticket } from '@goblin/shared';

/** Clipboard behavior and truthful feedback, for whatever a button copies. */
export function useCopy(text: string) {
  const [copied, setCopied] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = async () => {
    if (!text) return;
    setFailed(null);
    setCopied(null);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
    } catch {
      setFailed(text);
    }
  };
  return { copied: copied === text, failed: failed === text, copy };
}

/** Buttons and palette commands share one branch suggestion. */
export function useBranchCopy(ticket?: Pick<Ticket, 'key' | 'title'>) {
  const branch = ticket ? ticketBranchName(ticket) : '';
  return { branch, ...useCopy(branch) };
}
