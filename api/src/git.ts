/** What git answered: its output, the sentence it refused with, or that there is no git to ask. */
export type GitAnswer = { ran: true; ok: true; out: string } | { ran: true; ok: false; reason: string } | { ran: false };

const FAULT = /^(fatal|error): /;

/**
 * `worktree add` says what it is preparing before it says what went wrong, and
 * may give the way out on the line after, so the reason runs from the line that
 * names a fault to the end, as one line.
 */
function reasonIn(err: string): string {
  const lines = err.split('\n').filter((line) => line.trim() !== '');
  const fault = lines.findIndex((line) => FAULT.test(line));
  return lines.slice(Math.max(fault, 0)).join(' ').replace(FAULT, '');
}

/** The `git` on `PATH`. `LC_ALL` because the reasons callers read back have to be in the words they expect. */
export async function git(cwd: string, args: string[]): Promise<GitAnswer> {
  let child;
  try {
    child = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, LC_ALL: 'C' } });
  } catch {
    return { ran: false };
  }
  const [out, err, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (exit === 0) return { ran: true, ok: true, out: out.replace(/\n$/, '') };
  return { ran: true, ok: false, reason: reasonIn(err) };
}
