-- FAC-5: a run can ask you something and wait for the answer.
-- The question table existed from day one and nothing wrote it; these are the
-- columns the board needs to render an answer form, and the run link that lets
-- the approvals inbox find open questions without walking phases.

alter table question
  add column run_id       text references run(id) on delete cascade,
  add column header       text not null default '',
  add column multi_select boolean not null default false,
  add column answered_by  text;

-- One tool call asks 1–4 questions; they are answered as a set, in order.
alter table question add column seq integer not null default 0;

create index question_open_idx on question (run_id) where answered_at is null;
