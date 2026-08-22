-- FAC-13: ticket-to-ticket dependencies and project-level designs.
-- Dependencies are synced to Zero; project designs are read server-side only.

create table ticket_dep (
  blocker_id  text not null references ticket(id) on delete cascade,
  blocked_id  text not null references ticket(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id != blocked_id)
);
create index ticket_dep_blocked_idx on ticket_dep (blocked_id);

create table project_design (
  id          text primary key,
  project_id  text not null references project(id) on delete cascade,
  version     integer not null,
  markdown    text not null,
  created_at  timestamptz not null default now(),
  unique (project_id, version)
);

alter publication goblin_zero add table ticket_dep;
