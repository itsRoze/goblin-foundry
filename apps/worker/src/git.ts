import { execFile } from 'node:child_process';
import { mkdir, writeFile, appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export type Exec = { code: number; stdout: string; stderr: string };

export async function sh(cmd: string, args: string[], cwd: string, timeoutMs = 10 * 60_000): Promise<Exec> {
  try {
    const { stdout, stderr } = await run(cmd, args, { cwd, timeout: timeoutMs, maxBuffer: 32 << 20 });
    return { code: 0, stdout, stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string; message: string };
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? err.message };
  }
}

/** Run a shell command line (the project's own test/build commands). */
export async function shell(line: string, cwd: string, timeoutMs = 10 * 60_000): Promise<Exec> {
  return sh('/bin/sh', ['-lc', line], cwd, timeoutMs);
}

export async function git(repo: string, ...args: string[]): Promise<Exec> {
  return sh('git', args, repo);
}

export type Worktree = { path: string; branch: string; baseSha: string };

/**
 * One worktree per ticket, cut from the project's default branch.
 * `-p` runs never clean up after themselves, so removal is our job.
 */
export async function hasBranchWork(repo: string, branch: string, base: string): Promise<boolean> {
  const exists = await git(repo, 'rev-parse', '--verify', `refs/heads/${branch}`);
  if (exists.code !== 0) return false;
  const { stdout } = await git(repo, 'rev-list', '--count', `${base}..refs/heads/${branch}`);
  return Number(stdout.trim()) > 0;
}

export async function addWorktree(repo: string, branch: string, base: string): Promise<Worktree> {
  const path = join(repo, '.goblin', 'worktrees', branch.replace(/\//g, '-'));
  await mkdir(join(repo, '.goblin', 'worktrees'), { recursive: true });
  await excludeGoblinDir(repo);
  // A previous attempt may have left this worktree and branch behind: `-p` runs
  // never clean up, and a killed worker never gets the chance. Start clean.
  await git(repo, 'worktree', 'remove', '--force', path);
  await git(repo, 'worktree', 'prune');
  const add = await git(repo, 'worktree', 'add', '-B', branch, path, base);
  if (add.code !== 0) throw new Error(`git worktree add failed: ${add.stderr.trim()}`);
  // Pin the base commit: the branch it was cut from keeps moving, and diffing
  // against a moving name makes the builder's own work look undeclared.
  const sha = await git(path, 'rev-parse', 'HEAD');
  return { path, branch, baseSha: sha.stdout.trim() };
}

/**
 * A worktree on a branch that already exists — what the reviewer needs, since
 * the build that produced the branch removed its worktree on the way out. The
 * branch is never reset here: its commits are the thing under review.
 */
export async function attachWorktree(repo: string, branch: string, base: string): Promise<Worktree> {
  const path = join(repo, '.goblin', 'worktrees', branch.replace(/\//g, '-'));
  await mkdir(join(repo, '.goblin', 'worktrees'), { recursive: true });
  await excludeGoblinDir(repo);
  const exists = await git(repo, 'rev-parse', '--verify', `refs/heads/${branch}`);
  if (exists.code !== 0) throw new Error(`branch ${branch} does not exist in ${repo}`);
  const listed = await git(repo, 'worktree', 'list', '--porcelain');
  if (!listed.stdout.includes(`worktree ${path}\n`)) {
    await git(repo, 'worktree', 'prune');
    const add = await git(repo, 'worktree', 'add', path, branch);
    if (add.code !== 0) throw new Error(`git worktree add failed: ${add.stderr.trim()}`);
  }
  // The diff under review is the branch's own work: everything since it left
  // the base branch, not everything the base branch has done since.
  const merged = await git(path, 'merge-base', 'HEAD', base);
  const baseSha = merged.code === 0 && merged.stdout.trim()
    ? merged.stdout.trim()
    : (await git(path, 'rev-parse', 'HEAD')).stdout.trim();
  return { path, branch, baseSha };
}

export async function removeWorktree(repo: string, path: string) {
  await git(repo, 'worktree', 'remove', '--force', path);
}

/** `.goblin/` holds worktrees and materialized designs — never committed. */
async function excludeGoblinDir(repo: string) {
  const excludeFile = join(repo, '.git', 'info', 'exclude');
  const current = await readFile(excludeFile, 'utf8').catch(() => '');
  if (!current.includes('.goblin/')) await appendFile(excludeFile, '\n.goblin/\n');
}

/**
 * Designs are stored, never committed: the DB is authoritative and the worktree
 * gets a git-ignored copy so the agent can read it with plain file tools.
 */
export async function materializeDesign(worktree: string, markdown: string): Promise<string> {
  const dir = join(worktree, '.goblin');
  await mkdir(dir, { recursive: true });
  const path = join(dir, 'design.md');
  await writeFile(path, markdown, 'utf8');
  return path;
}

export async function changedFiles(worktree: string, base: string): Promise<string[]> {
  const tracked = await git(worktree, 'diff', '--name-only', base);
  const untracked = await git(worktree, 'ls-files', '--others', '--exclude-standard');
  return [...tracked.stdout.split('\n'), ...untracked.stdout.split('\n')]
    .map(s => s.trim()).filter(Boolean);
}

export async function isClean(worktree: string): Promise<boolean> {
  const { stdout } = await git(worktree, 'status', '--porcelain');
  return stdout.trim() === '';
}

export type Trailers = {
  ticket: string; run: string; phase: string; design: string | null;
};

/**
 * One commit per attempt, carrying provenance. The builder may commit as it
 * works — those commits have no trailers, and rewriting them is the only way to
 * guarantee every agent commit is traceable — so the branch is folded back to
 * its base and re-committed once the gates are green.
 */
export async function commitAll(worktree: string, message: string, t: Trailers, baseSha?: string): Promise<Exec> {
  if (baseSha) await git(worktree, 'reset', '--soft', baseSha);
  const trailers = [
    `Factory-Ticket: ${t.ticket}`,
    `Factory-Run: ${t.run}`,
    `Factory-Phase: ${t.phase}`,
    ...(t.design ? [`Factory-Design: ${t.design}`] : []),
    'Co-Authored-By: Goblin Builder <builder@goblin.foundry>',
  ].join('\n');
  await git(worktree, 'add', '-A');
  return git(worktree, 'commit', '-m', `${message}\n\n${trailers}`);
}

export async function hasCommitsSince(worktree: string, baseSha: string): Promise<boolean> {
  const { stdout } = await git(worktree, 'rev-list', '--count', `${baseSha}..HEAD`);
  return Number(stdout.trim()) > 0;
}

/** Pushes the branch as it stands; the pull request already exists. */
export async function pushBranch(worktree: string, branch: string): Promise<Exec> {
  return git(worktree, 'push', 'origin', branch);
}

export async function hasRemote(repo: string): Promise<boolean> {
  const { code, stdout } = await git(repo, 'remote');
  return code === 0 && stdout.trim().length > 0;
}

export async function pushAndOpenPr(
  worktree: string, branch: string, base: string, title: string, body: string,
): Promise<{ ok: boolean; url: string; detail: string }> {
  const push = await git(worktree, 'push', '-u', 'origin', branch);
  if (push.code !== 0) return { ok: false, url: '', detail: push.stderr.slice(-800) };
  const pr = await sh('gh', ['pr', 'create', '--base', base, '--head', branch,
    '--title', title, '--body', body], worktree);
  if (pr.code !== 0) return { ok: false, url: '', detail: pr.stderr.slice(-800) };
  return { ok: true, url: pr.stdout.trim().split('\n').at(-1) ?? '', detail: pr.stdout.trim() };
}
