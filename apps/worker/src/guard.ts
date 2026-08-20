import { isAbsolute, resolve } from 'node:path';

/**
 * The writes boundary. A phase works in its worktree and nowhere else — the
 * agent's own promise is not enough, so every tool call is checked before it
 * runs. Hook denies apply even under bypassPermissions, which makes this the
 * only place that can gate every call.
 */
export type Breach = { reason: string } | null;

/** Absolute paths an agent legitimately touches outside its worktree. */
const ALLOWED_PREFIXES = ['/tmp', '/private/tmp', '/var/folders', '/usr', '/bin', '/sbin', '/opt', '/dev/null', '/Library'];

const GIT_ESCAPES = [/\bgit\s+-C\b/, /--git-dir\b/, /--work-tree\b/, /\bGIT_DIR=/, /\bGIT_WORK_TREE=/];

export function checkTool(tool: string, input: unknown, worktree: string, protectedPaths: string[]): Breach {
  const i = (input ?? {}) as Record<string, unknown>;
  const root = resolve(worktree);

  if (typeof i.file_path === 'string') {
    const target = resolve(root, i.file_path);
    if (!within(target, root)) return { reason: `${tool} targets ${target}, outside the worktree ${root}` };
    const rel = target.slice(root.length + 1);
    const hit = protectedPaths.find(p => matches(rel, p));
    if (hit && tool !== 'Read') return { reason: `${rel} is a protected path (${hit})` };
  }

  if (tool === 'Bash' && typeof i.command === 'string') {
    const command = i.command;
    for (const pattern of GIT_ESCAPES) {
      if (pattern.test(command)) return { reason: `git redirection (${pattern.source}) is not allowed inside a worktree` };
    }
    for (const token of command.match(/(?:^|[\s='"`])(\/[^\s'"`;|&)]+)/g) ?? []) {
      const path = token.trim().replace(/^["'=`]/, '');
      if (!isAbsolute(path)) continue;
      // `/**` in a comment or a glob is not a path, and denying it stops an
      // agent mid-sentence for writing JSDoc. A path names something.
      if (!/^\/[A-Za-z0-9._~+-]/.test(path)) continue;
      if (within(resolve(path), root)) continue;
      if (ALLOWED_PREFIXES.some(prefix => path === prefix || path.startsWith(`${prefix}/`))) continue;
      return { reason: `command reaches ${path}, outside the worktree ${root}` };
    }
  }

  return null;
}

function within(target: string, root: string): boolean {
  return target === root || target.startsWith(`${root}/`);
}

/** Enough glob for policy paths: `.github/**`, `infra/**`, `*.lock`. */
function matches(rel: string, pattern: string): boolean {
  const rx = new RegExp(`^${pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\/?/g, '<<globstar>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<globstar>>/g, '.*')}$`);
  return rx.test(rel);
}
