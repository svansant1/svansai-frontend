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

-- November 2026 runtime extension. SOURCE ONLY: not applied by the coding pass.
-- Install only after reviewing/testing in a separate database. Public clients have
-- read-only RLS access; all mutations and lease RPCs require the server service role.
create table if not exists public.svans_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null,
  payload_hash text not null,
  payload jsonb not null check (octet_length(payload::text) <= 262144),
  state text not null default 'queued' check (state in ('queued','running','succeeded','failed','cancelled')),
  attempts integer not null default 0,
  max_attempts integer not null default 2 check (max_attempts between 1 and 2),
  cancel_requested boolean not null default false,
  lease_token uuid,
  lease_until timestamptz,
  worker_id uuid,
  result jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, idempotency_key)
);
alter table public.svans_jobs add column if not exists kind text not null default 'generation' check (kind in ('generation','lab'));
alter table public.svans_jobs add column if not exists approval_expires_at timestamptz;
alter table public.svans_jobs add column if not exists approved_at timestamptz;
alter table public.svans_jobs drop constraint if exists svans_jobs_state_check;
alter table public.svans_jobs add constraint svans_jobs_state_check
  check (state in ('waiting_approval','queued','running','succeeded','failed','cancelled','indeterminate'));
create index if not exists svans_jobs_queue_idx on public.svans_jobs(state,created_at);
create index if not exists svans_jobs_user_idx on public.svans_jobs(user_id,created_at desc);
alter table public.svans_jobs enable row level security;
revoke all on public.svans_jobs from anon, authenticated;
grant select on public.svans_jobs to authenticated;
grant all on public.svans_jobs to service_role;
drop policy if exists "Read own jobs" on public.svans_jobs;
create policy "Read own jobs" on public.svans_jobs for select to authenticated using ((select auth.uid()) = user_id);

create table if not exists public.svans_job_events (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.svans_jobs(id) on delete cascade,
  state text not null,
  detail text not null,
  created_at timestamptz not null default now()
);
create index if not exists svans_job_events_job_idx on public.svans_job_events(job_id,id);
alter table public.svans_job_events enable row level security;
revoke all on public.svans_job_events from anon, authenticated;
grant select on public.svans_job_events to authenticated;
grant all on public.svans_job_events to service_role;
grant usage, select on sequence public.svans_job_events_id_seq to service_role;
drop policy if exists "Read own job events" on public.svans_job_events;
create policy "Read own job events" on public.svans_job_events for select to authenticated using (
  exists(select 1 from public.svans_jobs j where j.id = job_id and j.user_id = (select auth.uid()))
);

create or replace function public.svans_enqueue_job(p_user uuid, p_payload jsonb, p_hash text, p_key text)
returns setof public.svans_jobs language plpgsql security invoker set search_path = '' as $$
declare existing public.svans_jobs; inserted public.svans_jobs;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user::text, 0));
  select * into existing from public.svans_jobs where user_id = p_user and idempotency_key = p_key;
  if found then
    if existing.kind <> 'generation' or existing.payload_hash <> p_hash then raise exception 'Idempotency key reused with different payload'; end if;
    return next existing; return;
  end if;
  if length(p_key) not between 16 and 100 or p_key !~ '^[A-Za-z0-9_-]+$' then raise exception 'Invalid idempotency key'; end if;
  if (select count(*) from public.svans_jobs where user_id = p_user and state in ('waiting_approval','queued','running')) >= 5 then raise exception 'Active job limit reached'; end if;
  insert into public.svans_jobs(user_id,payload,payload_hash,idempotency_key) values(p_user,p_payload,p_hash,p_key) returning * into inserted;
  insert into public.svans_job_events(job_id,state,detail) values(inserted.id,'queued','Request queued.');
  return next inserted;
end $$;

create or replace function public.svans_claim_job(p_worker uuid)
returns setof public.svans_jobs language plpgsql security invoker set search_path = '' as $$
declare claimed public.svans_jobs;
begin
  -- This queue runs reply/artifact generation only. Do NOT add external actions to
  -- lease replay: an unknown send/payment/deploy outcome requires reconciliation.
  update public.svans_jobs set state = case when cancel_requested then 'cancelled' when attempts >= max_attempts then 'failed' else 'queued' end,
    error_code = 'LEASE_EXPIRED', lease_token = null, lease_until = null, updated_at = now()
    where kind = 'generation' and state = 'running' and lease_until < now();
  select * into claimed from public.svans_jobs where kind = 'generation' and state = 'queued' and not cancel_requested
    order by created_at for update skip locked limit 1;
  if not found then return; end if;
  update public.svans_jobs set state = 'running', attempts = attempts + 1, worker_id = p_worker,
    lease_token = gen_random_uuid(), lease_until = now() + interval '60 seconds', updated_at = now(), error_code = null
    where id = claimed.id returning * into claimed;
  insert into public.svans_job_events(job_id,state,detail) values(claimed.id,'running','Worker started generation.');
  return next claimed;
end $$;

create or replace function public.svans_cancel_job(p_user uuid, p_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.svans_jobs set cancel_requested = true, state = case when state in ('queued','waiting_approval') then 'cancelled' else state end, updated_at = now()
    where id = p_id and user_id = p_user and state in ('waiting_approval','queued','running');
  if found then insert into public.svans_job_events(job_id,state,detail) values(p_id,'cancellation_requested','User requested cancellation.'); end if;
end $$;

create or replace function public.svans_heartbeat_job(p_id uuid, p_lease uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.svans_jobs set lease_until = now() + interval '60 seconds', updated_at = now()
    where id = p_id and lease_token = p_lease and state = 'running' and not cancel_requested and lease_until > now();
  return found;
end $$;

create or replace function public.svans_finish_job(p_id uuid, p_lease uuid, p_result jsonb, p_error text)
returns void language plpgsql security invoker set search_path = '' as $$
declare finished public.svans_jobs;
begin
  update public.svans_jobs set
    state = case when cancel_requested then 'cancelled' when p_error is not null then 'failed' else 'succeeded' end,
    result = case when cancel_requested or p_error is not null then null else p_result end,
    error_code = case when cancel_requested then 'CANCELLED' else p_error end,
    lease_token = null, lease_until = null, updated_at = now()
    where id = p_id and lease_token = p_lease and state = 'running' and lease_until > now() returning * into finished;
  if found then insert into public.svans_job_events(job_id,state,detail) values(p_id,finished.state,coalesce(finished.error_code,'Result saved.')); end if;
end $$;

revoke all on function public.svans_enqueue_job(uuid,jsonb,text,text) from public, anon, authenticated;
revoke all on function public.svans_claim_job(uuid) from public, anon, authenticated;
revoke all on function public.svans_cancel_job(uuid,uuid) from public, anon, authenticated;
revoke all on function public.svans_heartbeat_job(uuid,uuid) from public, anon, authenticated;
revoke all on function public.svans_finish_job(uuid,uuid,jsonb,text) from public, anon, authenticated;
grant execute on function public.svans_enqueue_job(uuid,jsonb,text,text), public.svans_claim_job(uuid), public.svans_cancel_job(uuid,uuid), public.svans_heartbeat_job(uuid,uuid), public.svans_finish_job(uuid,uuid,jsonb,text) to service_role;

create or replace function public.svans_append_job_event(p_id uuid, p_lease uuid, p_state text, p_detail text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_state not in ('started','validating','completed','failed','blocked','cancelled') or octet_length(p_detail) > 8192 then
    raise exception 'Invalid job event';
  end if;
  -- Lock makes a revocation/lease change atomic relative to this checkpoint.
  perform 1 from public.svans_jobs
    where id=p_id and lease_token=p_lease and state='running' and lease_until>now() and not cancel_requested
    for update;
  if not found then raise exception 'Job lease inactive'; end if;
  insert into public.svans_job_events(job_id,state,detail) values(p_id,p_state,p_detail);
end $$;
revoke all on function public.svans_append_job_event(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.svans_append_job_event(uuid,uuid,text,text) to service_role;

create table if not exists public.svans_artifacts (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  root_id uuid not null,
  parent_id uuid references public.svans_artifacts(id),
  object_path text not null unique,
  name text not null,
  format text not null,
  mime_type text not null,
  size integer not null check (size > 0 and size <= 8388608),
  sha256 text not null,
  created_at timestamptz not null default now()
);
create index if not exists svans_artifacts_versions_idx on public.svans_artifacts(user_id,root_id,created_at);
-- Source recipes support deterministic revisions of SVANS-generated files only.
alter table public.svans_artifacts add column if not exists source_content text
  check (source_content is null or length(source_content) <= 100000);
alter table public.svans_artifacts enable row level security;
revoke all on public.svans_artifacts from anon, authenticated;
grant select on public.svans_artifacts to authenticated;
grant all on public.svans_artifacts to service_role;
drop policy if exists "Read own artifacts" on public.svans_artifacts;
create policy "Read own artifacts" on public.svans_artifacts for select to authenticated using ((select auth.uid()) = user_id);
-- Provision a PRIVATE Storage bucket named svans-artifacts separately. The server
-- checks the bucket is private; do not add public object read/write policies.
