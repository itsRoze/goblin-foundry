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
- **Permissions still have to be deployed** (`zero-deploy-permissions`) or nothing
  syncs, even though the CLI prints "Permissions are deprecated".
