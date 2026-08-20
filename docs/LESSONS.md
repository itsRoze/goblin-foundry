# Lessons

Things that bit us while building the factory. Newest last.

- **Zero 1.9's schema builder has no `.unique()`.** The zbugs excerpt in
  `docs/research/03-zero-localfirst.md` shows `.unique('login')`; the installed
  1.9.0 types expose only `from`, `columns`, `primaryKey`, `optional`. Uniqueness
  is a Postgres constraint and nothing more.
- **`json<T>()` needs `T extends ReadonlyJSONValue`** — `json<unknown[]>()` fails
  to typecheck. Use `ReadonlyJSONValue[]` or a concrete object type.
- **zero-cache refuses to start without `--admin-password`** unless `NODE_ENV=development`.
  `ZERO_REPLICA_FILE` is resolved against the process cwd, so run zero-cache from the
  repo root (`just zero`), not from a package directory.
- **Postgres `timestamptz` maps to a Zero `number`** (epoch ms), verified in
  `zero-cache/src/types/pg-data-type.js`. So SQL keeps real timestamps and the client
  still gets numbers.
- **Client-side ZQL is legacy in Zero 1.9.** `createSchema` defaults
  `enableLegacyQueries: false`, so a query built with `createBuilder` and passed
  to `useQuery` registers with zero-cache but syncs **zero rows** — silently, no
  error anywhere. The supported path is `defineQueries`/`defineQuery` in shared
  code, `handleQueryRequest` on the API, and `ZERO_QUERY_URL` pointing zero-cache
  at it. `zero.query` is also `undefined` at runtime for the same reason.
- **zero-cache authenticates to the query endpoint with `X-Api-Key`** (from
  `ZERO_QUERY_API_KEY`), not a bearer token — verified in `zero-cache/src/custom/fetch.ts`.
- **Permissions are genuinely gone in Zero 1.9 — do not deploy them.** Deploying
  `definePermissions` looked like part of the fix for "nothing syncs"; it was not.
  Verified afterwards by setting `zero.permissions` to NULL: the board still
  syncs. The only real cause was client-side ZQL being legacy. Authorization
  belongs in the synced-query definitions and the API's write endpoints, which is
  where it lives.
- **An unguarded builder leaves its worktree immediately.** The first real run
  did `cat .env` within a minute: with
  `bypassPermissions` there is no boundary, and the agent treats the repo root as
  fair game. The PreToolUse guard (`apps/worker/src/guard.ts`) denies absolute
  paths outside the worktree, `git -C`/`--git-dir` redirection, and writes to
  policy-protected paths, and records a `permission_breach` event.
- **Check `git worktree add`'s exit code.** When a previous attempt left the
  branch behind, the add fails but the stale directory still exists, so the phase
  runs happily in the *old* worktree and nothing looks wrong in the trace.
- **Diff the worktree against the base *commit*, not the base *branch*.** The
  first green run failed `diff_matches_claims` on ten files the builder never
  touched: the base branch had moved on while the run was in flight, so
  `git diff --name-only <branch>` reported everything committed to the base since
  the worktree was cut. Pin `rev-parse HEAD` at creation and diff against that.
- **`useQuery` needs a stable request object.** Building
  `queries.ticket({shortId})` inline re-subscribes on every render, and the page
  sits on "Loading…" forever while `zero.run()` with the identical request returns
  the row instantly. Memoize on the args.
- **Never hand-edit a run's status to "canceled" while its process may still be
  alive.** Doing that let a second worker claim the same ticket: the first run
  finished, removed the shared worktree out from under the second, and both
  committed to the same branch. `pkill -f "apps/worker"` also does not match the
  tsx child — kill by pid or by the script path.
- **Provenance trailers only land if the harness makes the commit.** PR #1's
  commit had none: the builder committed its own work, and nothing rewrote it.
  Each attempt is now folded back to the worktree's base commit and re-committed
  once by the worker, so every agent commit carries Factory-Ticket / Factory-Run /
  Factory-Phase / Factory-Design.
- **`claude setup-token` needs a real TTY.** Run through the harness with stdin on
  /dev/null it hangs silently and prints nothing. Run it in a terminal window and
  paste the token into `.env` — verified working by running a throwaway `query()`
  with `CLAUDE_CONFIG_DIR` pointed at an empty directory, which removes the
  keychain login as a fallback.
- **A `continue` on the last loop iteration silently escapes the loop.** In the
  builder's gate loop, an unparseable report on the final attempt fell out of the
  loop with `envelope` still holding an *earlier* attempt whose gates had failed —
  and the run committed, opened a PR, and reported success. Track the green state
  explicitly rather than inferring it from loop exit.
- **zero-cache binds two ports, 4849 and 4850.** A second instance dies with a raw
  `exit code 255` whose only clue is an `EADDRINUSE` line buried in JSON. `just ps`
  now shows what is up and `just zero` refuses with a sentence instead.
