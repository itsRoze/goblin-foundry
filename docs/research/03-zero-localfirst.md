# Rocicorp Zero for a Linear-like Local-First Agentic Software Factory

Research date: 2026-08-18. Sources: zero.rocicorp.dev docs, rocicorp/mono (cloned `--depth 1` to
`/private/tmp/.../scratchpad/research/repos/mono`, `apps/zbugs`), npm registry, and third-party
2025-2026 blog posts/comparisons. All URLs cited inline.

---

## 1. Current version, maturity, production readiness, roadmap, pricing/hosting

**Version.** As of 2026-08-18, npm dist-tags for `@rocicorp/zero` are:
`latest = 1.9.0`, `canary = 1.9.1-canary.1`, `head = 1.10.0-head-<sha>-20260818` (checked via
`npm view @rocicorp/zero`). The cloned `rocicorp/mono` main-branch `packages/zero/package.json`
is at `"version": "1.10.0"` (pre-release/dev-ahead-of-latest). So **1.9.0 is the current stable
release**, with 1.10 in flight.

**1.0 milestone.** Zero reached 1.0 in June 2026 — "the first stable release of Rocicorp's web
sync engine," after "nearly two years of development, more than 50 releases, thousands of
commits, and hundreds of bugfixes." The 1.0 bump was largely symbolic (minimal functional diff
from 0.26.2); Rocicorp now commits to a stable public API with rare, minimal breaking changes.
[InfoQ: Zero Reaches 1.0](https://www.infoq.com/news/2026/06/zero-version-1/)

**Roadmap** ([zero.rocicorp.dev/docs/roadmap](https://zero.rocicorp.dev/docs/roadmap)):
Zero's own roadmap doc still frames a "beta" target of "late 2025 or early 2026" as "the point at
which Zero is a good choice for the average new rich web application" — the 1.0 announcement
above is effectively that milestone landing a bit later than planned. Q4-2025-era priorities
(now shipped in main): API/doc overhaul, deprecating legacy mutators/queries in favor of unified
**custom mutators + synced queries**, revised auth APIs, join planning / query-planner work,
disabling offline writes, and an invite-only SaaS. **Explicitly "post-beta" / not yet shipped**:
column-level permissions, aggregations (count/min/max/group-by), **server-side rendering**, JSON
filtering, and native full-text search. Confirmed independently: SSR remains unshipped as of the
1.0 release ([InfoQ](https://www.infoq.com/news/2026/06/zero-version-1/)).

**Known limitations** (from a hands-on review, [Marmelab, testing Zero 1.0](https://marmelab.com/blog/2025/02/28/zero-sync-engine.html)):
only Postgres is supported as upstream; Postgres *views* are not synced; some column types
(arrays) aren't supported; client API has weak error handling for rejected/failed mutations;
client bundle is non-trivial (718 KB uncompressed / 232 KB gzip). Zero's own docs
([when-to-use](https://zero.rocicorp.dev/docs/when-to-use)) state plainly: Zero is **not
local-first** in the offline/privacy sense — it's "a client-server system with an authoritative
server," it **does not support offline writes**, and it's TypeScript-client-only (though this now
includes React Native, see §2). Recommended dataset ceiling is **under 100GB** for the server-side
SQLite replica (theoretical max ~45TB on EC2 given SQLite's own limits, but "contact us" territory
beyond 100GB).

**Who uses it in production.**
- **Rocicorp's own bug tracker**, `bugs.rocicorp.dev`, runs on Zero continuously deployed off
  `main` to AWS — "millions of rows of data," the project's own dogfood.
  ([Samples](https://zero.rocicorp.dev/docs/samples), repo confirms `prod/sst/sst.config.ts`)
- **Productlane** rebuilt their customer-support tool on Zero.
- **Ranger** reports it "runs faster than any of their competitors" using Zero.
  (Both via search aggregation of Rocicorp's case studies; no single canonical URL surfaced —
  treat as vendor-reported claims, not independently verified.)
- Community sentiment is "positive on DX, more cautious on production readiness" — i.e., early
  production adopters exist but it is not yet a widely-battle-tested-at-scale system the way
  Postgres or Firebase are.

**Pricing / hosting.** **Self-host only today** — no generally-available managed/hosted offering.
The [deployment docs](https://zero.rocicorp.dev/docs/deployment) describe Docker Compose, Fly.io,
AWS-via-SST, and Kubernetes deployment recipes, all self-operated. The roadmap doc mentions an
"invitation-only SaaS" as a Q4-2025 target, but nothing publicly launched/priced was found as of
Aug 2026. **Practical implication for a solo dev: budget for running your own zero-cache +
Postgres, there is no "just pay Rocicorp" button yet.**

---

## 2. Architecture

### zero-cache topology
Two logical components (can run as one process for small deployments):
- **view-syncers** — serve client queries from a local SQLite replica; horizontally scalable (N
  instances behind a load balancer).
- **replication-manager** — bridges the Postgres logical-replication stream to the view-syncers;
  **must be a single instance** and **must never be exposed to the internet** (view-syncers talk
  to it over an internal port 4849; view-syncers themselves listen publicly on port 4848 and
  require WebSocket support at the LB).

Docs quote: *"The simplest way to deploy Zero is to run everything on a single node. This is the
least expensive way to run Zero, and it can take you surprisingly far."*
[zero.rocicorp.dev/docs/deployment](https://zero.rocicorp.dev/docs/deployment)

### Postgres requirements
- `wal_level=logical` required.
- Replication connection must be **direct**, not through PgBouncer/connection poolers.
- zbugs' local dev `docker-compose.yml` (in the cloned repo) shows the exact Postgres flags used:
  ```yaml
  command: |
    postgres
    -c wal_level=logical
    -c max_wal_senders=10
    -c max_replication_slots=5
    -c hot_standby=on
    -c hot_standby_feedback=on
  ```
  (`apps/zbugs/docker/docker-compose.yml`, Postgres 16.2-alpine image in that file; the deployment
  docs' own examples reference Postgres 18.)
- Zero 1.6 added **PlanetScale (for Postgres) failover support**; Zero 1.7 improved replication
  throughput ~1.8x over 1.6, and one customer's max sustainable replication went from **~750
  writes/sec to ~2500 writes/sec (>3x)** after the 1.7 upgrade.
  [Release notes summary](https://zero.rocicorp.dev/docs/release-notes) — this is the only
  concrete write-throughput number found; treat it as a ballpark for upstream Postgres→zero-cache
  replication, not a per-client sync number.

### Client model: ZQL, queries, IVM
- **ZQL** (Zero Query Language) is a Drizzle/Kysely-flavored TS query builder. Clients **never
  send arbitrary ZQL to the server** — instead the client sends a *named query + args*, and the
  server (your backend, via `defineQueries`/`handleQueryRequest`) returns the authoritative ZQL.
  This is the actual mechanism behind permissions today (see below) — it replaced the old
  declarative JSON permissions file.
- **IVM (Incremental View Maintenance):** the client materializes query results into a local
  SQLite (WASM/native) replica and keeps them updated via diffs, not re-fetching — "99% of
  queries in zero milliseconds" is Rocicorp's tagline (`github.com/rocicorp/mono` repo
  description). Zero syncs **the union of all currently-active queries' results** — overlapping
  queries across components/tabs don't double-sync data.
- **`useQuery` / `useZero`** (React, from `@rocicorp/zero/react`): `useZero()` returns the Zero
  client instance (used to call mutators); `useQuery(query)` is the reactive read hook, backed by
  IVM, that re-renders on any change to the query's result set.
- **Query lifecycle / TTL:** queries are either *active* (subscribed) or *cached*. `preload()`
  queries default to `ttl: 'none'` (stop syncing the instant nothing references them);
  interactive queries default to `ttl: '5m'`, configurable up to `10m`. The TTL clock only ticks
  while Zero is running (app-closed time doesn't count). Each query consumes **client memory for
  metadata and disk for state** — Zero's own docs call this out explicitly as a resource cost to
  be mindful of. [Queries docs](https://zero.rocicorp.dev/docs/queries)
- No documented **hard row cap** per query/client — resource limits are implicit (client
  memory/SQLite size), not enforced by the platform. Practical guidance from the docs: use
  `.limit()` and preload "the first n results for each shape/sort you intend to use," rather than
  syncing everything.

### Custom mutators (server-authoritative writes)
Introduced in v0.18, now the only supported mutation model (`enableLegacyMutators: false` in
zbugs' schema). A mutator is one TS function with:
1. An **optimistic client-side run** (against the local SQLite replica) for instant UI feedback.
2. An **authoritative server-side run** against real Postgres, invoked by zero-cache calling your
   `/api/mutate` (a.k.a. "push") endpoint.

Rocicorp provides `PushProcessor` to implement the push protocol against **any** database via an
abstract adapter; for Postgres it ships adapters for **Drizzle, Kysely, Prisma, node-postgres, and
postgres.js**. [Custom Mutators docs](https://zero.rocicorp.dev/docs/custom-mutators)

### Permissions model — has moved off declarative JSON
Older docs describe a compiled, JSON-based, row-level permissions system stored in
`{ZERO_APP_ID}.permissions` in upstream Postgres — **this is now marked deprecated**:
[RLS Permissions (Deprecated)](https://zero.rocicorp.dev/docs/deprecated/rls-permissions). The
zbugs source (current `main`, using `@rocicorp/zero` 1.10-head) confirms the replacement: **there
is no `permissions.ts` file at all**. Authorization is enforced imperatively, in code, inside:
- **custom queries** (`shared/queries.ts`) — e.g. `applyIssuePermissions()` filters non-crew users
  to `visibility = 'public'` rows before the query is ever handed back to zero-cache; `alwaysFalse(q)`
  is the idiom for "return nothing" when a user isn't authorized for a related sub-query
  (e.g., another user's private `viewState`/`notificationState` rows).
- **custom mutators** (`shared/mutators.ts` + `server/server-mutators.ts`) — e.g.
  `assertIsCreatorOrAdmin()` runs *before* any existence check ("Security: Auth check MUST come
  before existence check to prevent information disclosure about private issue existence" — a
  comment straight from the source) and throws a generic `MutationError` so unauthorized callers
  can't distinguish "doesn't exist" from "not yours."

This is a meaningfully different mental model than most BaaS permission DSLs: **permissions are
just TypeScript, co-located with the query/mutator that needs them**, not a separate rules file.
Good for expressiveness and testability; means there's no single audited "permissions.yaml" to
review — you have to trust the code discipline of every query/mutator author.

### Auth / JWT model
Two supported credential paths, configured via `ZeroOptions.auth`:
- **Token-based:** app supplies a JWT (or any bearer token); Zero forwards it as
  `Authorization: Bearer <token>` to both the query and mutate endpoints. zbugs uses this — its
  JWT payload (`shared/auth.ts`) is `{sub, role: 'crew'|'user', name, iat, exp}`, decoded
  server-side into an `AuthData` context (`{sub, role}`) that's threaded through every query and
  mutator (`ctx: authData`).
- **Cookie-based:** `ZERO_QUERY_FORWARD_COOKIES` / `ZERO_MUTATE_FORWARD_COOKIES` env vars make
  zero-cache forward the browser's `Cookie` header to your endpoints instead.

There's no built-in "Zero Auth" product — you bring your own auth provider (zbugs uses GitHub
OAuth via `@fastify/oauth2`, mints its own JWT, verifies with `jose`).

### Offline behavior
**No offline writes.** Docs are explicit: Zero is a client-server system with an authoritative
server and does not support extended offline functionality or offline mutation queuing beyond
normal optimistic-UI latency-hiding. If your factory needs "keep working on a plane," Zero is not
that.

### Schema definition & migrations
Schema is defined in TypeScript using `table()`, `relationships()`, `createSchema()` (see zbugs
excerpt in §3) — this schema is the **client-side/ZQL schema**, generated from/kept in sync with
your actual Postgres schema (zbugs additionally keeps a Drizzle schema, `db/drizzle-schema.ts`,
used with `drizzle-kit migrate` to manage the real Postgres DDL; the Zero TS schema is then
hand-maintained to match). There is no Zero-native migration tool — you migrate Postgres with
whatever tool you like (Drizzle Kit in zbugs' case) and keep the Zero schema file in sync; the
1.0 announcement mentions a **schema-change hook for Supabase** specifically, suggesting first-party
migration tooling is still being built out.

### Framework support
- **Official:** React (`@rocicorp/zero/react` — `useQuery`, `useZero`, `ZeroProvider`) and
  SolidJS (`@rocicorp/zero/solid`, `hello-zero-solid` template repo).
- **React Native/Expo:** also official/first-party (`@rocicorp/zero-react-native`), confirmed
  present in the cloned monorepo (`packages/zero-react-native`); requires a storage adapter
  (`expo-sqlite` or the faster `op-sqlite`, which needs a dev build, not Expo Go). Sample app:
  **zslack**. This directly contradicts the older "TypeScript clients only, no native mobile"
  line in the `when-to-use` doc — that line is stale as of the RN package's addition.
  [React Native docs](https://zero.rocicorp.dev/docs/react-native)
- **Community:** Vue and Svelte bindings exist as community packages (`zero-svelte`,
  `zero-svelte-query`), not Rocicorp-maintained.
- **No first-party TanStack Router/Query integration** was found; Zero is a competitor to
  TanStack DB/Query in this space, not an integration partner (see §5).
- **No SSR support yet** (roadmap item, not shipped) — relevant if you want fast first paint on a
  server-rendered shell.

### Deployment
- **Docker Compose:** full example in docs; zbugs' own local dev compose spins up two Postgres
  instances (primary + a "replica" used to sanity-check replication) with the logical-replication
  flags shown above.
- **Fly.io:** native support, with the replication-manager kept on Fly's private networking.
- **AWS via SST:** zbugs' actual production deploy (`prod/sst/sst.config.ts`, 279 lines) — VPC +
  ECS cluster + S3 bucket for the replication stream + `commonEnv` block wiring
  `ZERO_UPSTREAM_DB`, `ZERO_CVR_DB`, `ZERO_CHANGE_DB`, `ZERO_AUTH_JWK`, OpenTelemetry exporters,
  etc. Notably sets `healthCheckGracePeriodSeconds: 600` with the comment *"10 minutes should be
  more than enough time for gigabugs initial-sync"* — i.e., cold-start/initial-replication of a
  large dataset is slow enough to need a generous health-check grace period in production.
- **Kubernetes:** manifests provided in docs.
- Key env vars: `ZERO_UPSTREAM_DB`, `ZERO_CVR_DB` (client view records), `ZERO_CHANGE_DB`
  (replication log), `ZERO_REPLICA_FILE` (server-side SQLite path), `ZERO_QUERY_URL` /
  `ZERO_MUTATE_URL`, `ZERO_CHANGE_STREAMER_URI` (multi-node only).
- No Railway-specific docs page was found; Docker Compose + Fly.io are the clearest "solo dev"
  paths.

### DX gotchas (aggregated from docs + Marmelab review + repo)
- Non-trivial client bundle size (~232 KB gzip) for the sync engine alone.
- Postgres-only upstream; array columns and Postgres views unsupported.
- Weak client-side error surfacing for rejected mutations (per Marmelab).
- Two extra stateful services to run/monitor (replication-manager + view-syncer(s)) plus your
  Postgres — more moving parts than a plain REST+Postgres app, even in single-node mode.
- Permissions-as-code means no static audit surface; discipline (like the "auth before existence
  check" pattern in zbugs) has to be enforced by convention/review, not a schema linter.
- The whole custom-mutator/synced-query API is **recent** (deprecating an older
  declarative-permissions model) — expect docs/blog posts written before mid-2025 to describe an
  outdated API shape (several search results and even some `zero.rocicorp.dev` sub-pages, e.g.
  `deprecated/rls-permissions`, still reflect the old model).

---

## 3. zbugs — reusable Linear-like starting point

Source: `github.com/rocicorp/mono/tree/main/apps/zbugs`, cloned locally. Live demo at
`bugs.rocicorp.dev` (real dogfood instance) and a 1.2M-row / 2.5M-row-synced stress demo at
`gigabugs.rocicorp.dev` ("loads from cold start in <2s," per
[Samples](https://zero.rocicorp.dev/docs/samples)).

### Schema (abbreviated, from `apps/zbugs/shared/schema.ts`)
```ts
const user = table('user').columns({
  id: string(), login: string(), name: string().optional(),
  avatar: string(), role: enumeration<Role>(),
}).primaryKey('id').unique('login');

const project = table('project').columns({
  id: string(), name: string(), lowerCaseName: string(),
  issueCountEstimate: number().optional(), supportsSearch: boolean(),
  markURL: string().optional(), logoURL: string().optional(),
}).primaryKey('id').unique('name').unique('lowerCaseName');

const issue = table('issue').columns({
  id: string(), shortID: number().optional(), title: string(),
  open: boolean(), modified: number(), created: number(),
  projectID: string(), creatorID: string(), assigneeID: string().optional(),
  description: string(), visibility: enumeration<'internal' | 'public'>(),
}).primaryKey('id');

const comment = table('comment').columns({
  id: string(), issueID: string(), created: number(),
  body: string(), creatorID: string(),
}).primaryKey('id');

const label = table('label').columns({
  id: string(), name: string(), projectID: string(),
}).primaryKey('id').unique('projectID', 'name');

const issueLabel = table('issueLabel').columns({
  issueID: string(), labelID: string(), projectID: string(),
}).primaryKey('labelID', 'issueID');           // join table

const emoji = table('emoji').columns({
  id: string(), value: string(), annotation: string(),
  subjectID: string(),  // polymorphic: issue.id OR comment.id
  creatorID: string(), created: number(),
}).primaryKey('id');

const viewState = table('viewState').columns({
  issueID: string(), userID: string(), viewed: number(),
}).primaryKey('userID', 'issueID');            // per-user read-state (unread indicators)

const issueNotifications = table('issueNotifications').columns({
  userID: string(), issueID: string(), subscribed: boolean(), created: number(),
}).primaryKey('userID', 'issueID');

const userPref = table('userPref').columns({
  key: string(), userID: string(), value: string(),
}).primaryKey('userID', 'key');
```
Relationships are declared separately via `relationships(table, ({one, many}) => ({...}))`, e.g.
`issue.labels` is a **many-to-many through `issueLabel`** expressed as a two-hop `many()` with two
join specs; `emoji.issue`/`emoji.comment` model the polymorphic `subjectID` as two `one()`
relationships resolved by whichever table actually has that id — a pattern directly reusable for
"reactions on anything" (comments, designs, runs, events...) in our factory app.

**Tables map almost 1:1 onto our domain**: `project`→Project, `issue`→Ticket, `comment`→ticket
comments, `label`/`issueLabel`→ticket tags, `viewState`/`issueNotifications`→read-state and
subscriptions (directly reusable for "has this Run/Ticket been seen"), `emoji`→reactions.
**Not present**: anything resembling our high-volume Runs/Events — zbugs has no analog to an
append-only event stream table (see §4).

### Custom queries & mutators (current API, `shared/queries.ts` / `shared/mutators.ts` /
`server/server-mutators.ts`)
- `defineQueries({...})` / `defineQuery(argsZodSchema, resolverFn)` define **named, validated,
  server-authoritative queries** — e.g. `issueListV2` implements Linear-style list filtering
  (open/closed, project, assignee, creator, labels, free-text `ILIKE` search across title +
  description + comment bodies via `exists()`, cursor-based pagination via `.start()/.limit()`
  for forward/backward paging) — this `buildListQuery()` function is essentially a ready-made
  "ticket list with filters" query you could adapt directly.
- `defineMutators({...})` / `defineMutator(zodSchema, fn)` define client-optimistic mutators
  (`shared/mutators.ts`); `server/server-mutators.ts` **wraps each client mutator** to layer in
  server-only concerns (server timestamps via `Date.now()`, and firing `notify()` — a
  post-commit-task hook that sends Discord + email notifications). This client/server mutator
  wrapping pattern (call the shared mutator fn, then bolt on side effects with
  `postCommitTasks: PostCommitTask[]`) is a clean, directly-reusable pattern for our agent
  "Runs" — e.g., a ticket-status-change mutator could enqueue a Run-trigger the same way zbugs
  enqueues a notification.

### Features present (from repo + docs, `Samples` page)
Instant reads/writes, realtime sync, GitHub OAuth, fine-grained read/write permissions,
**complex filters** (status/project/assignee/creator/label/free-text, `issueListV2`/
`buildListQuery`), unread indicators (`viewState`), basic text search (`ILIKE`, not full-text —
matches the roadmap item "native text search" being unshipped), **emoji reactions** on both issues
and comments (`emoji` table + `emoji-picker-element`), notifications (Discord + email, via
post-commit tasks), short numeric issue IDs (`shortID`) alongside stable UUIDs, and **Linear-style
keyboard navigation** — confirmed in source: `useKeypress('j', ...)` / `useKeypress('k', ...)` for
next/prev issue in `issue-page.tsx`, `useKeypress('/', ...)` to focus search in `list-page.tsx`
(`apps/zbugs/src/hooks/use-keypress.ts`, `src/pages/issue/issue-page.tsx`,
`src/pages/list/list-page.tsx`).

### Permissions in zbugs
As described in §2: no declarative permissions file. `applyIssuePermissions()` in `queries.ts`
gates non-`crew` users to `visibility='public'` issues; `assertIsCreatorOrAdmin()` /
`assertUserCanSeeIssue()` / `assertUserCanSeeComment()` in `shared/auth.ts` gate mutators, always
checking auth *before* existence to avoid leaking whether a private issue exists.

### Deployment setup
- **Local dev:** `apps/zbugs/docker/docker-compose.yml` — two Postgres 16.2-alpine containers
  (`postgres_primary` on host port 6434, `postgres_replica` on 6435) both configured with
  `wal_level=logical`, `max_wal_senders=10`, `max_replication_slots=5`.
- **Production:** `prod/sst/sst.config.ts` (SST/Pulumi-on-AWS) — VPC, ECS cluster
  (`containerInsights: enhanced`), an S3 bucket for the replication stream, optional EBS-backed
  stage for a persistent SQLite replica file, full OpenTelemetry wiring
  (`OTEL_TRACES_EXPORTER=otlp`, resource detectors for env/host/os), and a 600-second ECS health
  check grace period explicitly sized for "gigabugs initial-sync." Deployed continuously off
  `main` to AWS.
- **Load testing:** `apps/zbugs/k6/script.js` — a k6 *browser* test (not an API-throughput test):
  10 virtual users, 10 iterations, drives a real Chromium browser through the deployed
  `zbugs.vercel.app` preview, clicking through nav items and periodically backgrounding/
  foregrounding the tab (comment in source: *"We disconnect the socket after a certain amount of
  time in the background, so bring to foreground periodically"* — a real operational quirk worth
  knowing: **Zero appears to intentionally drop the WebSocket when a tab is backgrounded**, and
  reconnects/resyncs on foreground).

### Reusability verdict
zbugs is **very reusable as a skeleton** for Projects/Tickets/Comments/Labels/Reactions/
Notifications — schema shapes, the filtered-list query, the keyboard-nav pattern, and the
client/server mutator-wrapping-for-side-effects pattern can be lifted close to as-is. It is **not**
a template for the Runs/Events half of our app (no analog exists in zbugs) — that part needs to be
designed fresh, informed by §4 below.

---

## 4. Fit for a high-frequency, append-only Events stream (swim-lane live view)

**Zero's own docs do not address this use case directly** — no page specifically discusses
event-sourcing, append-only logs, or "thousands of small rows per session" workloads. What's
documented, and what can be inferred:

- **No hard per-query/per-client row cap is documented.** Resource limits are implicit: "queries
  consume resources on both the client and server. Memory is used to keep metadata about the
  query, and disk storage is used to keep the query's current state"
  ([Queries docs](https://zero.rocicorp.dev/docs/queries)). For an actively-open swim-lane view
  subscribed to "all events for this Run, live," every new event row is a write that must
  propagate: Postgres → logical replication → replication-manager → view-syncer SQLite replica →
  diff computation (IVM) → WebSocket push → client SQLite replica update → React re-render. That's
  a lot of pipeline stages per row, for a table whose defining trait is "created very fast, in
  bursts."
- **Documented replication throughput is Postgres-upstream-side**, not client-fanout: Zero 1.7
  raised max sustainable replication from ~750 to ~2500 writes/sec in one customer's workload —
  useful as an order-of-magnitude ceiling for *global* write throughput through zero-cache, but
  says nothing about per-client sync latency once you're pushing thousands of rows/run to N
  simultaneously-watching browser tabs.
- **`when-to-use` explicitly frames Zero for "productivity apps with lots of interactivity"
  resembling Linear** — a domain of moderate-cardinality, human-edited rows (issues, comments) —
  not high-frequency machine-generated telemetry.
- **The first-party `@rocicorp/zero-virtual` package is a strong signal of intended usage
  pattern**: an "Infinite Virtual Scroller for Zero"
  ([npm](https://www.npmjs.com/package/@rocicorp/zero-virtual),
  [repo](https://github.com/rocicorp/zero-virtual)) that zbugs itself uses for its comments list
  (`commentsPage` cursor-paginated query in `shared/queries.ts`, windowed with `.start()`/
  `.limit()`/`orderBy(created, id)`). The existence of this package tells you Rocicorp's answer to
  "large ordered append-mostly collections" is: **don't sync the whole collection as one live
  query — page it, window it, and only keep a bounded slice of rows subscribed/rendered at once.**
  That pattern transfers directly to an events swim-lane: keep a live query only for "events after
  cursor X, limit N," not "all events for this run, unbounded."
- **TTL defaults (5m active, up to 10m) plus explicit "each query costs memory+disk" language**
  reinforce that Zero is optimized for a **bounded number of concurrently-active queries with
  moderate result sizes**, not one query streaming an unbounded, ever-growing result set.

**Recommendation for our design:** treat Zero as the source of truth for **ticket/project/run
metadata and summaries** (Run started/finished, cost roll-ups, status, last-N-events preview),
using the same windowed/cursor-paginated pattern zbugs uses for comments. For the **live,
high-frequency tool-call/log/cost event firehose while a run is in progress**, prefer a **separate
SSE/WebSocket channel direct from the agent runner to the browser** (or a lightweight pub/sub like
Postgres `LISTEN/NOTIFY` behind SSE) — bypassing zero-cache's replication pipeline for the
hot path — and only **persist a durable summary + capped tail (e.g., last 200 events, or
periodic checkpoints) into a Zero-synced table** once the run settles or on some interval. This
avoids putting the full firehose through logical replication and per-row IVM diffing, keeps
zero-cache's write load in the ~hundreds-to-low-thousands/sec range it's demonstrated at, and
keeps client SQLite replicas from growing unbounded on multi-hour agent runs. This is an inference
from architecture + the zero-virtual precedent, not a documented Rocicorp recommendation — no
source explicitly blesses or rules out high-frequency streams through Zero, so treat it as
informed judgment, not a citation.

---

## 5. Alternatives comparison matrix

| Tool | Dev speed | Postgres-native | Self-hostable | Maturity (Aug 2026) | TS DX | Offline writes | Event-stream fit |
|---|---|---|---|---|---|---|---|
| **Zero** (Rocicorp) | High — ZQL is Drizzle/Kysely-like, IVM gives snappy UI | Yes, Postgres-only upstream | Yes (Docker/Fly/AWS/K8s); no managed offering yet | 1.0 shipped Jun 2026; "positive DX, cautious on prod-scale" per community | Excellent, first-class React/Solid/RN | **No** | Unclear/likely poor for raw firehose; good for windowed summaries |
| **ElectricSQL + TanStack DB** | Medium-high; TanStack DB is "backend-agnostic," works with existing REST/GraphQL, lowest migration cost if already on TanStack Query | Yes, Postgres logical replication → SQLite/PGlite on client | Yes, OSS | Actively evolving; one hands-on report called Electric's long-polling sync "should be avoided at all costs" ([johnny.sh](https://johnny.sh/blog/choosing-a-sync-engine-in-2026/)) — mixed field reports | Good | Partial (via PGlite) | Not addressed in sources found |
| **PowerSync** | Medium; mature SDKs, especially mobile/React Native | Yes — also supports MongoDB, MySQL, SQL Server | **Open Edition is free/self-hostable** (source-available); Enterprise self-host adds SLA/SOC2 ([docs.powersync.com/intro/self-hosting](https://docs.powersync.com/intro/self-hosting)) | Most mature/battle-tested of the bunch per multiple sources; SOC2+HIPAA compliance achieved Jan 2026 | Good | **Yes**, strong offline story | Not the focus; built for CRUD sync, not high-freq telemetry |
| **InstantDB** | High for greenfield/AI-coded apps — "backend in one prompt" positioning | Yes, Postgres-backed, WAL-tailed (Figma LiveGraph/Asana WorldStore-inspired) | Yes, fully OSS, `docker-compose` self-host ([github.com/instantdb/instant](https://github.com/instantdb/instant)) | Growing fast, less enterprise track record than PowerSync | Good | Client-first design, data lives on client with background sync | Not addressed |
| **Convex** | Very high — pure TS queries/mutations, automatic caching/auth/storage built in | **No** — proprietary document/relational store, not Postgres | Yes since ~2024/2025 (`convex-backend` OSS, Docker or binary); local dev via `npx convex dev` | Most mature *hosted* option; "safer pick for non-experimental teams" per one 2026 comparison ([johnny.sh](https://johnny.sh/blog/choosing-a-sync-engine-in-2026/)) | Excellent | Limited — local deployments have no public URL, need ngrok-style tunneling for browser WS access | Reactive queries could work for summaries; not evaluated for raw firehose here |
| **LiveStore** | Medium — event-sourced mental model, single-writer-per-store | Backend-agnostic (you write the sync backend) | Yes, OSS | "Nearly chosen" in a real project per johnny.sh, praised for performance, Cloudflare-deployable | Good | Yes (event log replays locally) | **Best conceptual fit** of this list for event-sourced/audit/replay semantics — "the right call for event-sourced, log-driven apps" ([PkgPulse](https://www.pkgpulse.com/guides/tanstack-db-vs-zero-vs-livestore-sync-engines-2026)) — but constrained to **one SQLite instance per user/session**, awkward for a shared multi-viewer swim-lane |
| **Jazz** | Medium | No — CRDT-based, own storage model | Yes, OSS ([jazz.tools](https://jazz.tools/)) | Listed as "honorary mention," not deeply evaluated in sources found | Decent | Yes (CRDT-native) | Not evaluated in sources found |
| **Triplit** | Was promising | Own model | Yes, OSS but **team was acqui-hired by Supabase in Aug 2025; project is now community-maintained** ([johnny.sh](https://johnny.sh/blog/choosing-a-sync-engine-in-2026/)) | **Governance risk** — treat as effectively stalled for new adoption | Good | Yes | Not evaluated |

Key synthesis quotes:
- *"Zero (from Rocicorp, the Replicache successor) is the strongest end-to-end story when you can
  adopt their server protocol and a Postgres backend."* — [johnny.sh](https://johnny.sh/blog/choosing-a-sync-engine-in-2026/)
- *"TanStack DB is the safest 2026 pick if you want incremental, reactive client-side queries that
  compose with TanStack Query and run anywhere."* — same source
- *"Event-sourced app or one that needs replay/audit semantics: LiveStore. Don't try to retrofit
  event sourcing onto TanStack DB; you'll fight the model."* — [PkgPulse](https://www.pkgpulse.com/guides/tanstack-db-vs-zero-vs-livestore-sync-engines-2026)
- *"For migrating enterprise data: use PowerSync or ElectricSQL. For building a new collaborative
  SaaS (Notion/Figma clone): use Zero, Triplit, or InstantDB."* — [PkgPulse](https://www.pkgpulse.com/guides/tanstack-db-vs-zero-vs-livestore-sync-engines-2026)

### Recommendation for a solo developer wanting Linear-like snappiness with minimal ops
**Zero is the right default** for the Projects/Tickets/Designs/Comments core of this app: it's
purpose-built for exactly this shape of app (Rocicorp's own dogfood *is* a Linear-clone), the
zbugs codebase is close to a working starting template (schema, filtered-list query,
keyboard-nav, reactions, notifications all reusable), it's Postgres-native (no new database to
learn/operate), and single-node self-hosting is explicitly documented as viable and "surprisingly
far"-reaching. The trade-offs to accept going in: no offline writes, no managed hosting (you run
zero-cache + Postgres yourself, e.g., one Fly.io app or one Docker Compose box), it's genuinely
young (1.0 as of June 2026), and you'll be fighting slightly-stale docs/blog posts because the
query/mutator/permissions API changed shape recently.

**For the Events/Runs firehose specifically**, don't force it through Zero — pair Zero (for
Projects/Tickets/Designs + Run summaries) with a **direct SSE/WebSocket stream from the agent
runner** for the live swim-lane, persisting only checkpoints/summaries back into Zero-synced
tables. This two-tier approach (Zero for stable/interactive data, a raw stream for
high-frequency telemetry) matches how Zero's own zbugs handles its one analogous problem
(large ordered comment threads) — via windowed queries + `zero-virtual`, not one giant live
subscription — just pushed further for a genuinely-high-frequency, ephemeral-during-the-run
data source that doesn't need full sync-engine machinery (permissions, optimistic writes,
multi-device consistency) while the run is actively streaming.

**Minimal-ops path:** single Fly.io (or single Docker Compose VPS) node running Postgres +
zero-cache together, React + `useQuery`/`useZero`, custom mutators/queries per the zbugs pattern,
JWT auth via whatever's simplest (e.g., Supabase Auth or Clerk minted into a JWT Zero verifies),
SSE endpoint on the same backend for the event firehose. Revisit multi-node zero-cache only if/when
concurrent-user query load actually requires horizontal view-syncer scaling — which, for a
personal factory tool, may never happen.

---

## Source list

- InfoQ, Zero Reaches 1.0 — https://www.infoq.com/news/2026/06/zero-version-1/
- Marmelab, Testing Zero (hands-on review) — https://marmelab.com/blog/2025/02/28/zero-sync-engine.html
- Zero docs: When To Use — https://zero.rocicorp.dev/docs/when-to-use
- Zero docs: Deployment — https://zero.rocicorp.dev/docs/deployment
- Zero docs: Permissions (current model overview) — https://zero.rocicorp.dev/docs/permissions
- Zero docs: RLS Permissions (Deprecated) — https://zero.rocicorp.dev/docs/deprecated/rls-permissions
- Zero docs: Custom Mutators — https://zero.rocicorp.dev/docs/custom-mutators
- Zero docs: Queries — https://zero.rocicorp.dev/docs/queries
- Zero docs: Roadmap — https://zero.rocicorp.dev/docs/roadmap
- Zero docs: Release Notes index — https://zero.rocicorp.dev/docs/release-notes
- Zero docs: Samples — https://zero.rocicorp.dev/docs/samples
- Zero docs: React Native — https://zero.rocicorp.dev/docs/react-native
- Zero docs: Self-Hosting — https://zero.rocicorp.dev/docs/self-host
- Zero docs: Postgres Support — https://zero.rocicorp.dev/docs/postgres-support
- rocicorp/mono (source, cloned) — https://github.com/rocicorp/mono (apps/zbugs, packages/zero, packages/zero-react-native, prod/sst/sst.config.ts)
- rocicorp/zero-virtual — https://github.com/rocicorp/zero-virtual , https://www.npmjs.com/package/@rocicorp/zero-virtual
- Custom-mutator server implementation notes — https://jeremykreutzbender.com/blog/server-implementation-plan-rocicorp-zero-custom-mutators
- Jökull Sólberg, Notes on Zero — https://www.solberg.is/zero
- johnny.sh, Choosing a Sync Engine for Local-First in 2026 — https://johnny.sh/blog/choosing-a-sync-engine-in-2026/
- PkgPulse, TanStack DB vs Zero vs LiveStore — https://www.pkgpulse.com/guides/tanstack-db-vs-zero-vs-livestore-sync-engines-2026
- PowerSync self-hosting docs — https://docs.powersync.com/intro/self-hosting
- PowerSync open-source packages — https://powersync.com/open-source
- InstantDB repo — https://github.com/instantdb/instant
- Convex self-hosting docs — https://docs.convex.dev/self-hosting
- Convex open source — https://www.convex.dev/open-source
- Jazz — https://jazz.tools/
- npm registry, @rocicorp/zero dist-tags (checked live 2026-08-18)
