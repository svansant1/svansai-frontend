create table if not exists public.writing_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  preserve_voice boolean not null default true,
  correct_english boolean not null default true,
  preserve_intentional_slang boolean not null default true,
  default_context text not null default 'general' check (default_context in ('general','casual','professional','academic','sensitive')),
  tone_notes text not null default '',
  samples jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.writing_profiles enable row level security;

drop policy if exists "Users can read their writing profile" on public.writing_profiles;
create policy "Users can read their writing profile"
on public.writing_profiles for select using (auth.uid() = user_id);

drop policy if exists "Users can insert their writing profile" on public.writing_profiles;
create policy "Users can insert their writing profile"
on public.writing_profiles for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update their writing profile" on public.writing_profiles;
create policy "Users can update their writing profile"
on public.writing_profiles for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can delete their writing profile" on public.writing_profiles;
create policy "Users can delete their writing profile"
on public.writing_profiles for delete using (auth.uid() = user_id);

create table if not exists public.user_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('writing_preference','learning_progress','personal_preference','project_context')),
  summary text not null,
  source text not null default 'user' check (source in ('user','approved_feedback','system_suggestion')),
  confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_memories_user_category_idx on public.user_memories(user_id, category);
alter table public.user_memories enable row level security;

drop policy if exists "Users control their memories" on public.user_memories;
create policy "Users control their memories"
on public.user_memories for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create table if not exists public.conversation_analytics (
  id uuid primary key default gen_random_uuid(),
  request_id text not null,
  session_id text,
  user_id uuid references auth.users(id) on delete set null,
  route text not null,
  modules jsonb not null default '[]'::jsonb,
  module_reasons jsonb not null default '[]'::jsonb,
  capabilities jsonb not null default '[]'::jsonb,
  response_mode text not null,
  provider_selected text,
  provider_plan jsonb not null default '[]'::jsonb,
  latency_ms integer not null default 0,
  retry_count integer not null default 0,
  quality_score numeric,
  quality_reasons jsonb not null default '[]'::jsonb,
  files_used integer not null default 0,
  memory_used integer not null default 0,
  research_used boolean not null default false,
  fallback_used boolean not null default false,
  failure_reason text,
  prompt_version text,
  created_at timestamptz not null default now()
);

create index if not exists conversation_analytics_request_idx on public.conversation_analytics(request_id);
create index if not exists conversation_analytics_user_created_idx on public.conversation_analytics(user_id, created_at desc);
alter table public.conversation_analytics add column if not exists prompt_version text;
alter table public.conversation_analytics enable row level security;

drop policy if exists "Users can read their conversation analytics" on public.conversation_analytics;
create policy "Users can read their conversation analytics"
on public.conversation_analytics for select using (auth.uid() = user_id);
