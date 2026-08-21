-- FAC-10: every project gets a short, unique, uppercase key, so a ticket ref
-- (`<KEY>-<shortId>`) is unambiguous across every project, not just the first
-- one. Mirrors packages/schema/src/ref.ts's deriveProjectKey(): initials of a
-- multi-word slug, or the first three letters of a single-word one, with a
-- numeric suffix on collision.

alter table project add column key text;

do $$
declare
  proj record;
  words text[];
  base text;
  candidate text;
  n int;
begin
  for proj in select id, slug from project order by created_at loop
    words := array_remove(regexp_split_to_array(regexp_replace(proj.slug, '[^a-zA-Z0-9]+', ' ', 'g'), '\s+'), '');

    if array_length(words, 1) > 1 then
      base := '';
      for n in 1 .. least(array_length(words, 1), 4) loop
        base := base || upper(left(words[n], 1));
      end loop;
    else
      base := upper(left(coalesce(words[1], 'prj'), 3));
    end if;

    -- Mirrors ref.ts's deriveProjectKey(): a slug starting with a digit must
    -- not derive a key a ref can't be parsed back out of.
    if base !~ '^[A-Za-z]' then
      base := 'P' || base;
    end if;

    candidate := base;
    n := 2;
    while exists (select 1 from project where key = candidate) loop
      candidate := base || n::text;
      n := n + 1;
    end loop;

    update project set key = candidate where id = proj.id;
  end loop;
end $$;

-- The factory's own tickets have been FAC- since day one; "goblin-foundry"
-- derives GF, so the override is explicit rather than accidental.
update project set key = 'FAC' where slug = 'goblin-foundry';

alter table project alter column key set not null;
alter table project add constraint project_key_unique unique (key);
