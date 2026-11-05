import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

/** What a folder named as a Checkout comes to: the folder to record, or the sentence saying why not. */
export type ResolvedCheckout = { ok: true; folder: string } | { ok: false; reason: string };

type GitAnswer = { ran: true; ok: true; out: string } | { ran: true; ok: false; reason: string } | { ran: false };

/** `LC_ALL` because the one reason this module reads back has to be in the words it expects. */
async function git(cwd: string, args: string[]): Promise<GitAnswer> {
  let child;
  try {
    child = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, LC_ALL: 'C' } });
  } catch {
    return { ran: false };
  }
  const [out, err, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (exit === 0) return { ran: true, ok: true, out: out.replace(/\n$/, '') };
  return { ran: true, ok: false, reason: (err.split('\n')[0] ?? '').replace(/^fatal: /, '') };
}

function kindOf(folder: string): 'folder' | 'file' | null {
  try {
    const stat = statSync(folder, { throwIfNoEntry: false });
    if (!stat) return null;
    return stat.isDirectory() ? 'folder' : 'file';
  } catch {
    // a path the OS will not even look up (a NUL in it, a parent that is a file) is no more a folder than a missing one
    return null;
  }
}

/** `~` the way a person types it; a shell would have expanded it for the CLI, and nothing does for the GUI's field. */
const expandHome = (folder: string) => (folder === '~' ? homedir() : folder.startsWith('~/') ? join(homedir(), folder.slice(2)) : folder);

/**
 * The main working tree of the repository `top` belongs to. A linked worktree
 * has a top level of its own, but it is a place somebody is working for now,
 * not where the repository lives. `worktree list` names the main one first, and
 * a bare repository has none, so a worktree of one is the only folder there is.
 */
async function mainWorkingTree(top: string): Promise<string> {
  const list = await git(top, ['worktree', 'list', '--porcelain']);
  if (!list.ran || !list.ok) return top;
  const [first, second] = list.out.split('\n');
  return first?.startsWith('worktree ') && second !== 'bare' ? first.slice('worktree '.length) : top;
}

/**
 * The repository's own top-level folder, for any folder inside it, as an
 * absolute path. It shells out to the `git` on `PATH` and asks nothing of the
 * network. A server's working directory is nobody's idea of where they are, so
 * a relative path is refused rather than resolved against it. Refusals quote
 * the folder as it was typed.
 */
export async function resolveCheckout(typed: string): Promise<ResolvedCheckout> {
  const folder = expandHome(typed);
  if (!isAbsolute(folder)) return { ok: false, reason: `wants an absolute path, not ${typed}` };
  const kind = kindOf(folder);
  if (kind === null) return { ok: false, reason: `no folder at ${typed}` };
  if (kind === 'file') return { ok: false, reason: `${typed} is a file, not a folder` };

  const top = await git(folder, ['rev-parse', '--show-toplevel']);
  if (!top.ran) return { ok: false, reason: `git is not on the tracker's PATH, so ${typed} cannot be checked` };
  if (!top.ok) return { ok: false, reason: top.reason.startsWith('not a git repository') ? `${typed} is not inside a git repository` : `git cannot use ${typed}: ${top.reason}` };
  return { ok: true, folder: await mainWorkingTree(top.out) };
}
