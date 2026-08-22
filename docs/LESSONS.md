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
- **The agent's shell inherits everything the worker has.** Measured, not assumed:
  a throwaway phase running `env | grep -c` saw 4 of the factory's secrets. Passing
  an explicit `env` (minus the factory's own credentials) plus
  `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` takes that to 0 while the CLI keeps the
  credential it needs to authenticate.
- **Zero gives up after ~60s and does not come back.** Once the client reports
  `disconnected (Zero was unable to connect for 60 seconds)`, calling
  `zero.connection.connect()` returns without error and without reconnecting —
  `online` stays false. Only a reload recovers, which is why the offline bar
  offers exactly that.
- **Never clear Zero's IndexedDB while a tab is open.** Chrome defers the delete
  until every connection closes, so each surviving tab blocks the others and the
  client stalls in its local-read phase — the console shows
  `Connection attempt timed out … reading deleted clients`, and zero-cache logs
  *nothing*, because no socket is ever opened. Close every tab on the origin,
  then open one. Diagnosing this from the server costs an hour: the replica, the
  CVR and the API all look perfectly healthy, because they are.
- **`canUseTool` is skipped under `bypassPermissions` — except for
  `AskUserQuestion`.** The SDK warns `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`
  ("canUseTool will not be invoked … use a PreToolUse hook instead"), and for
  ordinary tools that is true, which is why the worktree guard is a hook. A
  question round still routes through the callback: verified with a throwaway
  phase that asked one question, parked while the answer arrived over the API,
  and read it back. Returning `{behavior: 'allow', updatedInput: {...input,
  answers}}` is how the answer reaches the agent — keyed by the question text.
- **A wedged Zero client opens no socket at all, and everything server-side
  looks perfect.** After switching the stack to a second worktree the board sat
  on "connecting" forever: zero-cache logged no connection, the browser made no
  request to :4849, and a raw `new WebSocket` to the same host opened fine — so
  the client never reached the network. `/zero/query` answered every named query
  correctly when called directly with `["transform", [...]]` and `X-Api-Key`,
  which is the fastest way to rule the server out. The remaining cause is the
  local IndexedDB phase, and the only fix is tab hygiene: close *every* tab on
  the origin — including ones from an older dev server on the same port — and
  open exactly one.
- **The worktree guard read `/**` as a path and denied the tool call.** A
  reviewer running `node -e` with a JSDoc comment in it — and its refuter
  subagents — were denied twice, after which the agent gave up and wrote its
  findings as prose instead of the report JSON, so the phase failed on an
  invalid envelope with a perfectly good review inside it. The token scan now
  requires a path to start with a real character, and denials are worth watching
  for exactly this reason: a false positive does not look like a guard problem
  from the outside, it looks like an agent that cannot follow instructions.
- **Running out of money looked exactly like a crash.** A planner run three grill
  rounds deep died with `planner:worker_error` and no cost recorded, and a
  reviewer died the same way when the plan window closed — the SDK reports both
  as a thrown error result, and a generic catch turns "you have no budget left"
  into "something went wrong". They are named now (`budget_exhausted`,
  `usage_limit`) and never retried, since another attempt learns the same thing
  at the same price. The measured numbers: a three-round interview with the
  perspective subagents does not fit in $6, and a reviewer left to fuzz freely
  spent $14 on a ten-line function across attempts that each got their own cap.
- **An interview is the expensive artifact, not the design.** When that planner
  run died it took twelve answered questions with it, and a fresh run would have
  asked all twelve again. Every answer the human has ever given on a ticket is
  now part of the next planner's opening prompt, marked settled.
- **`just ps` said the worker was down while it was running, and I killed a live
  run on the strength of it.** The api and the worker are both
  `tsx --env-file=../../.env src/index.ts` started from their own package
  directory, so `pgrep -f "worker/src/index.ts"` matches neither and
  `pgrep -f "tsx.*src/index.ts"` matches both — the first reads as "worker down",
  the second takes the api out with it. The worker sets
  `process.title = 'goblin-worker'` now, and `just ps` / `just stop` match on
  that. The rule underneath: never conclude a process is dead from a pattern you
  have not proven matches it when it is alive.
- **SIGTERM does not stop a run, only the next claim.** The worker's stop flag is
  checked between ticks, so `just stop` (or a plain `pkill`) leaves the phase in
  flight — a second worker started straight afterwards runs alongside the first,
  and the "stopped" one keeps writing events to a run you have already closed
  out. Hard-kill by pid when you need the run itself to end, and check
  `pgrep -f goblin-worker` returns nothing before starting another.
- **Hitting the turn limit threw away thirteen minutes of finished work.** A
  builder on a three-slice ticket ran out of turns with twelve files edited, a
  migration written and a new module tested — and because the limit surfaces as
  a thrown error, the phase died with no envelope, no cost recorded, and a
  worktree the next attempt would have wiped (`worktree add -B` resets the
  branch). A limit that leaves work on disk now buys one more turn in the same
  session: stop, report what you changed, say what remains. The other half of
  the fix is upstream — a design that names independently shippable slices
  should leave as one pull request per slice, not one branch that dies at turn 80.
- **`useQuery`'s second return value is not optional to ignore.** `[rows] =
  useQuery(q)` compiles fine and looks complete, but Zero delivers rows
  incrementally — `rows` can pass through `length === 1` on its way to
  `length === 2` before the result settles. A legacy-ref chooser that decided
  ambiguity off `rows.length` alone could auto-navigate to the first candidate
  to arrive and destroy the history entry before the second one landed. The
  fix is `const [rows, result] = useQuery(q)` and gating any decision on
  `result.type === 'complete'`.
- **A key derived from a slug can start with a digit, and a ref grammar that
  requires a leading letter cannot round-trip it.** `deriveProjectKey('3d-printer')`
  produced `'3P'`; `parseRef(formatRef('3P', 1))` returned `null`, so a project
  with a numeric-leading slug would derive a key the app could format but never
  parse back out of its own URLs. Verified by writing the round-trip as a
  property test (`deriveProjectKey` → `formatRef` → `parseRef` for a table of
  slugs) rather than trusting the hand-picked examples in the original tests,
  none of which happened to start with a digit.
- **A retry that re-cuts the branch pays to rebuild what it already had.** The
  same slice of FAC-10 was written three times: each attempt hit a limit, and
  the next one cut `goblin/fac-10` fresh from base (`worktree add -B`), erasing
  it. A ticket branch carrying commits beyond base is not stale — it is an
  earlier attempt that ran out of turns — so the run now attaches to it and the
  builder's opening prompt lists what is already there, told to continue rather
  than start again.
- **Measure your denials before trusting your guard.** Of 29 recorded
  `permission_breach` events, 19 were false: JavaScript regex literals, glob
  characters and quoted relative paths, all read as absolute filesystem paths by
  a heuristic that only asked "does it start with a slash". The true positives —
  a `cat` of the factory's `.env`, reads of the parent repo, `git -C`
  redirection — are worth keeping, which is the argument for fixing the
  heuristic rather than loosening the boundary.
- **pi has no structured-output mode, and does not need one here.** The Claude
  runner asks the SDK for `outputFormat: json_schema`; pi returns text, so the
  envelope comes from the JSON-in-final-message fallback both runners already
  carry. A probe phase on `opencode-go/kimi-k3` returned a valid envelope, one
  tool call and a real cost line ($0.0106, 2 turns) on the first attempt —
  the useful part is that the same `PhaseResult` came back, so nothing
  downstream of the runner could tell which harness answered.
- **`ModelRuntime.create()` finds `OPENCODE_API_KEY` on its own**, and one key
  authenticates two providers: `opencode` (Zen — Claude, GPT, Gemini,
  pay-as-you-go) and `opencode-go` (the $10 window — Kimi, DeepSeek, GLM, Qwen,
  MiniMax, Grok). Which one a phase reaches is the provider half of its model
  ref, so the failover lane and the cheap lane are the same credential.
- **A rejected push finished the run as a success.** FAC-10's second slice built,
  committed, failed to push (the remote branch still held an unmerged review-fix
  commit), and the phase reported success anyway — so the board showed the work
  shipped while no pull request existed at all. A push that never reached the
  remote now fails the run with `push_rejected`.
- **Append-only logs conflict on every long-lived branch.** `docs/DECISIONS.md`
  and `docs/LESSONS.md` both grow at the end, so any branch alive for more than
  an afternoon collides with the trunk in exactly the place where both sides are
  right. `.gitattributes` marks them `merge=union`; that is what union merge is
  for, and no agent or human should be retyping log lines.
- **A worktree needs its own install after a dependency change.** Merging a
  branch that added a package leaves the worktree's node_modules behind, and
  typecheck fails on a module that is genuinely in package.json.
- **Catching a branch up with its base makes the diff gates fail the agent for
  the base's work.** `diff_matches_claims` measures the worktree against the
  base commit pinned when the worktree was created; merging the base in moves
  every file the base changed into that diff, where it reads as an undeclared
  change the agent never mentioned. A correct review fix — tests green — was
  failed for `.gitattributes` and nine files it had never opened, and the run
  died at $17.87. Catching up must move the pinned base commit with it.
- **A guard that knows one harness's field names waves the other one through.**
  Claude Code's file tools say `file_path`; pi's say `path`. The guard read only
  the first, so every file operation a pi agent made — including a write to a
  protected path — passed unchecked, while looking guarded from the outside.
  Found by unit-testing the pi extension rather than by watching a run, which is
  the only way this class of hole shows up: nothing fails, nothing is denied,
  and the trace looks clean.
- **A module that connects to Postgres at import cannot be unit-tested, and
  neither can anything importing it.** Three test files had been split apart to
  route around it before the pi guard made it a fourth. The worker's `sql`
  handle is now a proxy that connects on first use.
- **A note left on a design that was then approved went nowhere.** The UI puts
  an annotation box beside an Approve button, the note is stored on the design,
  and the claim query selected only `markdown` — so the builder never saw it and
  nothing said so. Notes were only ever read by a *new planner run*, which
  happens when a design is sent back, not when it is approved. Approval notes
  now reach the builder's opening prompt as instructions that outrank the
  design, and the reviewer judges against them too.
- **A failing run re-armed its own claim, 12,357 times.** The guard that stops a
  ticket being re-claimed after a failure compared failures against the ticket's
  `updated_at` — and the failure path calls `clearDelegate`, which set
  `updated_at = now()`. So every failure reset the guard that was supposed to
  stop it, and the review pipeline spun at 1.4 runs a second for two hours
  against a branch that genuinely conflicted with its base. It cost nothing only
  because `base_conflict` fails before any agent starts; the same loop around a
  phase that reaches a model would have emptied the budget in minutes.
  Three lessons, all now enforced: a column that means "a human touched this"
  must never be written by the machine; a specific guard needs a general
  breaker behind it (run *rate*, which catches loops nobody predicted); and a
  failure that took no time at all should be followed by a wait.
