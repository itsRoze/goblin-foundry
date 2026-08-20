-- Goblin Foundry — initial schema.
-- Shapes follow the blueprint's Object model + Observability sections.
-- snake_case here; the Zero schema maps to camelCase via .from().

-- ── Artifacts ────────────────────────────────────────────────────────────────

create table project (
  id             text primary key,
  slug           text not null unique,
  name           text not null,
  repo_path      text not null,
  repo_remote    text,
  default_branch text not null default 'main',
  policy         jsonb not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Fixed kinds drive the agents; names/colors/order are per project (Linear's model).
create table status (
  id         text primary key,
  project_id text not null references project(id) on delete cascade,
  kind       text not null check (kind in (
               'backlog','ready_for_design','designing','design_review','ready_for_dev',
               'building','in_review','ready_to_merge','deploying','done','canceled')),
  name       text not null,
  color      text not null,
  sort_order integer not null,
  enabled    boolean not null default true,
  unique (project_id, kind)
);

create table ticket (
  id         text primary key,
  project_id text not null references project(id) on delete cascade,
  short_id   integer not null,
  title      text not null,
  body       text not null default '',
  type       text not null default 'feature'
             check (type in ('feature','bug','chore','proposal')),
  status_id  text not null references status(id),
  priority   integer not null default 2,
  size_hint  text,
  scope      jsonb not null default '{"included":[],"excluded":[]}'::jsonb,
  assignee   text,   -- the human
  delegate   text,   -- the agent currently on it
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, short_id)
);
create index ticket_status_idx on ticket (status_id);

create table comment (
  id         text primary key,
  ticket_id  text not null references ticket(id) on delete cascade,
  author     text not null,
  body       text not null,
  created_at timestamptz not null default now()
);
create index comment_ticket_idx on comment (ticket_id, created_at);

create table label (
  id         text primary key,
  project_id text not null references project(id) on delete cascade,
  name       text not null,
  color      text not null default '#5B6578',
  unique (project_id, name)
);

create table ticket_label (
  ticket_id text not null references ticket(id) on delete cascade,
  label_id  text not null references label(id) on delete cascade,
  primary key (ticket_id, label_id)
);

-- Designs are STORED, never committed. The worker materializes markdown into the
-- worktree at a git-ignored path at run start; this table is authoritative.
create table design (
  id          text primary key,
  ticket_id   text not null references ticket(id) on delete cascade,
  version     integer not null,
  status      text not null default 'draft'
              check (status in ('draft','in_review','approved','rejected','superseded')),
  markdown    text not null,
  review_html text,
  notes       jsonb not null default '[]'::jsonb,
  created_by  text not null default 'planner',
  approved_by text,
  approved_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (ticket_id, version)
);

-- ── Process spine: Run → Phase → Event ───────────────────────────────────────

create table run (
  id                 text primary key,
  ticket_id          text not null references ticket(id) on delete cascade,
  project_id         text not null references project(id) on delete cascade,
  design_id          text references design(id),
  trigger            text not null,
  worktree           text,
  branch             text,
  status             text not null default 'queued'
                     check (status in ('queued','running','awaiting_input','success','fail','canceled')),
  terminal_reason    text,
  cost_usd           double precision not null default 0,
  input_tokens       bigint not null default 0,
  output_tokens      bigint not null default 0,
  cache_read_tokens  bigint not null default 0,
  cache_write_tokens bigint not null default 0,
  lease_expires_at   timestamptz,
  heartbeat_at       timestamptz,
  pid                integer,
  host               text,
  started_at         timestamptz not null default now(),
  ended_at           timestamptz
);
create index run_ticket_idx on run (ticket_id, started_at desc);

create table phase (
  id                  text primary key,
  run_id              text not null references run(id) on delete cascade,
  seq                 integer not null,
  kind                text not null check (kind in ('agent','code','human')),
  name                text not null,
  agent               text,
  model               text,
  effort              text,
  session_id          text,
  attempt             integer not null default 1,
  retries             integer not null default 0,
  status              text not null default 'queued'
                      check (status in ('queued','running','awaiting_input','success','fail')),
  error               text,
  compiled_prompt_ref text,
  cost_usd            double precision not null default 0,
  input_tokens        bigint not null default 0,
  output_tokens       bigint not null default 0,
  cache_read_tokens   bigint not null default 0,
  cache_write_tokens  bigint not null default 0,
  num_turns           integer not null default 0,
  started_at          timestamptz,
  ended_at            timestamptz,
  unique (run_id, seq)
);

-- Append-only trace. NOT Zero-synced: the live tail and history are the same
-- cursor query, served over SSE (see docs/DECISIONS.md).
create table event (
  id         bigserial primary key,
  run_id     text not null references run(id) on delete cascade,
  phase_id   text references phase(id) on delete cascade,
  parent_id  bigint,
  type       text not null check (type in (
               'phase_start','agent_start','message','tool_call','question','answer',
               'gate_pass','gate_fail','handoff','log','error','agent_end','phase_end')),
  name       text not null default '',
  payload    jsonb not null default '{}'::jsonb,
  tokens     bigint,
  started_at timestamptz not null default now(),
  ended_at   timestamptz   -- only spanning types (tool_call) fill this
);
create index event_run_idx on event (run_id, id);
create index event_phase_idx on event (phase_id, id);

-- ── Contracts: envelopes, gates, questions ───────────────────────────────────

create table envelope (
  id          text primary key,
  phase_id    text not null references phase(id) on delete cascade,
  agent       text not null,
  output_type text not null,
  payload     jsonb not null,
  raw         text,
  valid       boolean not null default true,
  attempt     integer not null default 1,
  created_at  timestamptz not null default now()
);

create table gate (
  id         text primary key,
  phase_id   text not null references phase(id) on delete cascade,
  attempt    integer not null default 1,
  gate       text not null,
  passed     boolean not null,
  checks     jsonb not null default '[]'::jsonb,   -- [{item, ok, note}]
  created_at timestamptz not null default now()
);

create table question (
  id          text primary key,
  phase_id    text not null references phase(id) on delete cascade,
  prompt      text not null,
  options     jsonb not null default '[]'::jsonb,
  recommended text,
  answer      text,
  asked_at    timestamptz not null default now(),
  answered_at timestamptz
);

-- sessionStore mirror. Worker-only; never synced.
create table transcript_entry (
  id          bigserial primary key,
  project_key text not null,
  session_id  text not null,
  subpath     text not null default '',
  uuid        text,
  entry       jsonb not null,
  created_at  timestamptz not null default now()
);
create unique index transcript_uuid_idx on transcript_entry (session_id, subpath, uuid)
  where uuid is not null;

-- ── Live transport: one NOTIFY per event, payload = run id ───────────────────

create function notify_event() returns trigger as $$
begin
  perform pg_notify('goblin_event', new.run_id);
  return null;
end;
$$ language plpgsql;

create trigger event_notify after insert on event
  for each row execute function notify_event();

-- ── Zero replication: only the interactive tables ────────────────────────────

create publication goblin_zero for table
  project, status, ticket, comment, label, ticket_label,
  design, run, phase, envelope, gate, question;
