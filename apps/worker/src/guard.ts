import { isAbsolute, resolve } from 'node:path';

/**
 * The writes boundary. A phase works in its worktree and nowhere else — the
 * agent's own promise is not enough, so every tool call is checked before it
 * runs. Hook denies apply even under bypassPermissions, which makes this the
 * only place that can gate every call.
 */
export type Breach = { reason: string } | null;

/** Absolute paths an agent legitimately touches outside its worktree. */
const ALLOWED_PREFIXES = ['/tmp', '/private/tmp', '/var/folders', '/usr', '/bin', '/sbin', '/opt', '/dev', '/Library'];

/**
 * The directories that actually exist at the root of a machine. Everything else
 * beginning with a slash — `/g` and `/gu,` from a regex, `/**` from a comment,
 * `/src/app.ts` quoted inside a string — is not a path, and denying it stops an
 * agent mid-sentence for writing ordinary code. Two thirds of every denial this
 * harness recorded were this mistake.
 */
const REAL_ROOTS = [
  'Users', 'home', 'root', 'etc', 'var', 'tmp', 'private', 'usr', 'bin', 'sbin',
  'opt', 'dev', 'proc', 'sys', 'mnt', 'media', 'srv', 'run',
  'Library', 'System', 'Applications', 'Volumes', 'Network', 'cores',
];

/** Is this token plausibly an absolute filesystem path, rather than a regex? */
export function looksLikePath(token: string): boolean {
  if (!token.startsWith('/') || token.startsWith('//')) return false;
  const first = token.slice(1).split('/')[0] ?? '';
  return REAL_ROOTS.includes(first);
}

const GIT_ESCAPES = [/\bgit\s+-C\b/, /--git-dir\b/, /--work-tree\b/, /\bGIT_DIR=/, /\bGIT_WORK_TREE=/];

export function checkTool(tool: string, input: unknown, worktree: string, protectedPaths: string[]): Breach {
  const i = (input ?? {}) as Record<string, unknown>;
  const root = resolve(worktree);

  // Claude Code's tools say `file_path`; pi's say `path`. A guard that knows
  // only one of them waves the other harness straight through.
  const filePath = typeof i.file_path === 'string' ? i.file_path
    : typeof i.path === 'string' ? i.path : null;
  if (filePath !== null) {
    const target = resolve(root, filePath);
    // Scratch space is scratch space whichever tool reaches for it: Bash could
    // already write /tmp, and a tool allowlist that disagrees with itself just
    // teaches an agent to shell out.
    const scratch = ALLOWED_PREFIXES.some(prefix => target === prefix || target.startsWith(`${prefix}/`));
    if (!within(target, root) && !scratch) {
      return { reason: `${tool} targets ${target}, outside the worktree ${root}` };
    }
    if (within(target, root)) {
      const rel = target.slice(root.length + 1);
      const hit = protectedPaths.find(p => matches(rel, p));
      if (hit && tool !== 'Read') return { reason: `${rel} is a protected path (${hit})` };
    }
  }

  if (tool === 'Bash' && typeof i.command === 'string') {
    const command = i.command;
    for (const pattern of GIT_ESCAPES) {
      if (pattern.test(command)) return { reason: `git redirection (${pattern.source}) is not allowed inside a worktree` };
    }
    for (const token of command.match(/(?:^|[\s='"`])(\/[^\s'"`;|&)]+)/g) ?? []) {
      const path = token.trim().replace(/^["'=`]/, '');
      if (!isAbsolute(path) || !looksLikePath(path)) continue;
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
