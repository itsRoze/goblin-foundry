-- Which harness ran a phase. `claude-code` is the Claude Agent SDK (a Claude
-- Code subprocess); `pi` is the in-process pi runner, which can speak to any
-- provider it can authenticate. Recorded per phase because the A/B that decides
-- where each kind of work belongs is a comparison of counters per harness.

alter table phase add column harness text not null default 'claude-code'
  check (harness in ('claude-code', 'pi'));

create index phase_harness_idx on phase (harness, name);
