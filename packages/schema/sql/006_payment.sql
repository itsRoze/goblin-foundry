-- FAC-22: record how a phase was paid for instead of assuming it, and track
-- real spend separately from the runner's list-price estimate.

-- The lane's provider (`anthropic`, `opencode-go`, ...), alongside the harness
-- column that already exists. Null on the code phases that never call a model.
alter table phase add column provider text;

-- What the tier declared before the session started, and what the runner's own
-- evidence showed once it had run. The observed value wins wherever the two
-- disagree; `unknown` is what a phase gets when there is no evidence yet,
-- including every row recorded before this column existed.
alter table phase add column declared_paid_by text not null default 'unknown'
  check (declared_paid_by in ('subscription', 'plan', 'api-key', 'unknown'));
alter table phase add column observed_paid_by text
  check (observed_paid_by in ('subscription', 'plan', 'api-key', 'unknown'));

-- Real dollars, as opposed to `run.cost_usd`, which stays a list-price estimate
-- of a currency a subscription or plan lane never spends. Incremented only by
-- phases whose payment method is `api-key` or, conservatively, `unknown`.
alter table run add column billable_usd double precision not null default 0;
