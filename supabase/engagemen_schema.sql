create table if not exists page_views (
  id uuid primary key default gen_random_uuid(),
  path text not null,
  session_id text,
  user_id uuid references auth.users(id) on delete set null,
  user_agent text,
  created_at timestamptz not null default now()
);

create table if not exists message_feedback (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade,
  message_index integer not null,
  vote text not null check (vote in ('up', 'down')),
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table page_views enable row level security;
alter table message_feedback enable row level security;

drop policy if exists "public_can_insert_page_views" on page_views;
create policy "public_can_insert_page_views"
on page_views
for insert
with check (true);

drop policy if exists "public_can_select_page_views" on page_views;
create policy "public_can_select_page_views"
on page_views
for select
using (true);

drop policy if exists "public_can_insert_feedback" on message_feedback;
create policy "public_can_insert_feedback"
on message_feedback
for insert
with check (true);

drop policy if exists "public_can_select_feedback" on message_feedback;
create policy "public_can_select_feedback"
on message_feedback
for select
using (true);