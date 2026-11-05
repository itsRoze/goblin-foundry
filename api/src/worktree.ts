import { existsSync, realpathSync } from 'node:fs';
import { basename, join } from 'node:path';
import { worktreeSlug, type AppBranches, type CheckoutBranch } from '@goblin/shared';
import { expandHome } from './checkout';
import { git, listedWorktrees } from './git';

export interface WorktreeRequest {
  checkout: string;
  branch: string;
  /** What a new branch is cut from; left out, the Checkout's own default branch. */
  base?: string | undefined;
  root: string;
}

/** The Worktree, or the sentence saying why there is none. */
export type WorktreeOutcome = { ok: true; branch: string; folder: string } | { ok: false; reason: string };

const refuse = (reason: string): WorktreeOutcome => ({ ok: false, reason });
const noGit = (checkout: string) => refuse(`git is not on the tracker's PATH, so no Worktree can be made in ${checkout}`);

const hasRef = async (checkout: string, ref: string) => {
  const answer = await git(checkout, ['show-ref', '--verify', '--quiet', ref]);
  return answer.ran && answer.ok;
};

/** `origin` first, as git's own `checkout.defaultRemote` advice has it, so two remotes holding a name give one answer. */
async function remotesOf(checkout: string): Promise<string[]> {
  const answer = await git(checkout, ['remote']);
  if (!answer.ran || !answer.ok || answer.out === '') return [];
  return answer.out.split('\n').sort((a, b) => Number(b === 'origin') - Number(a === 'origin'));
}

/** `origin/<name>`, for a branch only a remote holds. */
async function remoteTracking(checkout: string, name: string): Promise<string | undefined> {
  for (const remote of await remotesOf(checkout)) if (await hasRef(checkout, `refs/remotes/${remote}/${name}`)) return `${remote}/${name}`;
  return undefined;
}

/** A remote-tracking branch named in full means the local branch that follows it, never a new local one called `origin/x`. */
async function localName(checkout: string, asked: string): Promise<string> {
  if (await hasRef(checkout, `refs/heads/${asked}`)) return asked;
  for (const remote of await remotesOf(checkout)) if (asked.startsWith(`${remote}/`) && (await hasRef(checkout, `refs/remotes/${asked}`))) return asked.slice(remote.length + 1);
  return asked;
}

/**
 * The Checkout's default branch, from what this machine already knows: what it
 * recorded as the remote's, then the two names git has always defaulted
 * to, then wherever the Checkout is.
 */
async function checkoutDefaultBranch(checkout: string): Promise<string> {
  const recorded = await git(checkout, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  if (recorded.ran && recorded.ok) {
    const local = recorded.out.slice('origin/'.length);
    return (await hasRef(checkout, `refs/heads/${local}`)) ? local : recorded.out;
  }
  for (const name of ['main', 'master']) if (await hasRef(checkout, `refs/heads/${name}`)) return name;
  return 'HEAD';
}

/** False for a Checkout `git init` left as it was: no commit anywhere, so nothing a new branch could be cut from. */
async function hasCommit(checkout: string): Promise<boolean> {
  const first = await git(checkout, ['rev-list', '-n', '1', '--all']);
  return !(first.ran && first.ok && first.out === '');
}

/** The name git can cut from, for a base that may exist only on a remote. */
async function resolveBase(checkout: string, base: string): Promise<string | undefined> {
  const commit = await git(checkout, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${base}^{commit}`]);
  return commit.ran && commit.ok ? base : remoteTracking(checkout, base);
}

/**
 * The linked worktree that has `branch` checked out. The first entry `worktree
 * list` gives is the main working tree, which is the Checkout itself and not a
 * place a Ticket is worked: asking for its branch reaches `worktree add`, and
 * git says where that branch is in use.
 */
function linkedFolder(listing: string, branch: string): string | undefined {
  return listedWorktrees(listing)
    .slice(1)
    .find((worktree) => worktree.branch === branch)?.folder;
}

/** `<root>/<repository folder name>`, which holds a Checkout's Worktrees. */
const worktreesIn = (checkout: string, root: string) => join(expandHome(root), basename(checkout));

/** Where each branch is checked out, by branch; a folder deleted by hand is still listed until it is pruned, and is nowhere. */
function checkedOut(listing: string): Map<string, CheckoutBranch['checked_out']> {
  const where = new Map<string, CheckoutBranch['checked_out']>();
  listedWorktrees(listing).forEach(({ branch, folder }, at) => {
    if (branch !== undefined && existsSync(folder)) where.set(branch, { folder, linked: at > 0 });
  });
  return where;
}

/** What is in the Checkout right now, or the sentence saying why that cannot be read. Nothing is stored and nothing is fetched. */
export async function readBranches(checkout: string, root: string): Promise<{ ok: true; branches: AppBranches } | { ok: false; reason: string }> {
  if (!existsSync(checkout)) return { ok: false, reason: `the Checkout ${checkout} is not there` };
  const refs = await git(checkout, ['for-each-ref', '--format=%(refname) %(symref)', 'refs/heads', 'refs/remotes']);
  if (!refs.ran) return { ok: false, reason: `git is not on the tracker's PATH, so ${checkout} cannot be read` };
  if (!refs.ok) return { ok: false, reason: refs.reason };
  const listing = await git(checkout, ['worktree', 'list', '--porcelain']);
  const where = listing.ran && listing.ok ? checkedOut(listing.out) : new Map();
  const remotes = await remotesOf(checkout);

  // a remote's HEAD is a pointer at one of its branches, not a branch
  const names = refs.out.split('\n').filter((line) => line !== '' && line.endsWith(' ')).map((line) => line.trimEnd());
  const local = names
    .filter((ref) => ref.startsWith('refs/heads/'))
    .map((ref) => ref.slice('refs/heads/'.length))
    .map((name) => ({ name, kind: 'local' as const, local: name, checked_out: where.get(name) ?? null }));
  const remote = remotes.flatMap((from) =>
    names
      .filter((ref) => ref.startsWith(`refs/remotes/${from}/`))
      .map((ref) => {
        const short = ref.slice(`refs/remotes/${from}/`.length);
        return { name: `${from}/${short}`, kind: 'remote' as const, local: short, checked_out: null };
      }),
  );
  const branches = [...local, ...remote];
  return { ok: true, branches: { default: await checkoutDefaultBranch(checkout), worktrees_in: worktreesIn(checkout, root), branches, has_commit: branches.length > 0 || (await hasCommit(checkout)) } };
}

/**
 * Makes or adopts the worktree of `checkout` on `branch`, in
 * `<root>/<repository folder name>/<branch slug>`. An existing branch is checked
 * out, one only a remote holds is created tracking it, and any other is cut from
 * `base`. A branch already in a linked worktree is that Worktree, which is what
 * makes a repeated Start converge on one folder. It never fetches.
 */
export async function makeWorktree({ checkout, branch: asked, base, root }: WorktreeRequest): Promise<WorktreeOutcome> {
  if (!existsSync(checkout)) return refuse(`the Checkout ${checkout} is not there`);
  const named = await git(checkout, ['check-ref-format', `refs/heads/${asked}`]);
  if (!named.ran) return noGit(checkout);
  if (!named.ok || asked.startsWith('-')) return refuse(`${asked} is not a name git allows for a branch`);

  const branch = await localName(checkout, asked);
  const listing = await git(checkout, ['worktree', 'list', '--porcelain']);
  if (!listing.ran) return noGit(checkout);
  if (!listing.ok) return refuse(listing.reason);
  const adopted = linkedFolder(listing.out, branch);
  // a folder deleted by hand is still listed until it is pruned, and a Ticket must not remember a place that is gone
  if (adopted !== undefined && existsSync(adopted)) return { ok: true, branch, folder: adopted };

  const slug = worktreeSlug(branch);
  if (/^\.*$/.test(slug)) return refuse(`${branch} leaves nothing to name a folder with`);
  const folder = join(worktreesIn(checkout, root), slug);

  let how: string[];
  if (await hasRef(checkout, `refs/heads/${branch}`)) how = [folder, branch];
  else {
    const remote = await remoteTracking(checkout, branch);
    if (remote !== undefined) how = ['--track', '-b', branch, folder, remote];
    else {
      const wanted = base ?? (await checkoutDefaultBranch(checkout));
      const from = await resolveBase(checkout, wanted);
      if (from === undefined) return refuse((await hasCommit(checkout)) ? `no branch or commit named ${wanted} in ${checkout}` : `${checkout} has no commit yet, so there is nothing to cut ${branch} from`);
      // tracking the base would point a later `git push` at the branch it was cut from
      how = ['--no-track', '-b', branch, folder, from];
    }
  }
  const added = await git(checkout, ['worktree', 'add', '--quiet', ...how]);
  if (!added.ran) return noGit(checkout);
  if (!added.ok) return refuse(added.reason);
  // what git will list it as next time, through any symlink in the root, so a repeat answers with the same string
  return { ok: true, branch, folder: realpathSync(folder) };
}
