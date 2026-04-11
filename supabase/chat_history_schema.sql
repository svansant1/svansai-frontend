create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New Chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

alter table conversations enable row level security;
alter table messages enable row level security;

create policy "users_can_view_own_conversations"
on conversations
for select
using (auth.uid() = user_id);

create policy "users_can_insert_own_conversations"
on conversations
for insert
with check (auth.uid() = user_id);

create policy "users_can_update_own_conversations"
on conversations
for update
using (auth.uid() = user_id);

create policy "users_can_delete_own_conversations"
on conversations
for delete
using (auth.uid() = user_id);

create policy "users_can_view_own_messages"
on messages
for select
using (
  exists (
    select 1
    from conversations
    where conversations.id = messages.conversation_id
      and conversations.user_id = auth.uid()
  )
);

create policy "users_can_insert_own_messages"
on messages
for insert
with check (
  exists (
    select 1
    from conversations
    where conversations.id = messages.conversation_id
      and conversations.user_id = auth.uid()
  )
);

create policy "users_can_delete_own_messages"
on messages
for delete
using (
  exists (
    select 1
    from conversations
    where conversations.id = messages.conversation_id
      and conversations.user_id = auth.uid()
  )
);