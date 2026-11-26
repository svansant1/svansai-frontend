-- Version matches the migration recorded by the hosted Supabase migration API.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
-- Core project/context/owner foundation only; workers and artifact publication remain disabled.
-- Derived from cyber_context_runtime.sql, with service-only privileges and FK indexes.
create table if not exists public.sv_owner_control (
  user_id uuid primary key references auth.users(id) on delete cascade,
  epoch bigint not null default 0
);
create table if not exists public.sv_owner_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  attempted_at timestamptz not null default clock_timestamp()
);
create index if not exists sv_owner_attempts_user_time on public.sv_owner_attempts(user_id, attempted_at);
create table if not exists public.sv_owner_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  revision integer not null default 1,
  last_activity_at timestamptz not null default clock_timestamp(),
  idle_locks_at timestamptz not null default (clock_timestamp() + interval '30 minutes'),
  revoked_at timestamptz
);
create index if not exists sv_owner_grants_user on public.sv_owner_grants(user_id);
alter table public.sv_owner_control enable row level security;
alter table public.sv_owner_attempts enable row level security;
alter table public.sv_owner_grants enable row level security;
revoke all on public.sv_owner_control, public.sv_owner_attempts, public.sv_owner_grants from public, anon, authenticated;
grant all on public.sv_owner_control, public.sv_owner_attempts, public.sv_owner_grants to service_role;

create or replace function public.sv_owner_reserve_attempt(p_user uuid) returns jsonb
language plpgsql security invoker set search_path = pg_catalog, public as $$
declare v_epoch bigint; v_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('sv-owner:' || p_user::text, 0));
  insert into public.sv_owner_control(user_id) values(p_user) on conflict do nothing;
  select epoch into v_epoch from public.sv_owner_control where user_id = p_user;
  delete from public.sv_owner_attempts where user_id = p_user and attempted_at <= clock_timestamp() - interval '15 minutes';
  select count(*) into v_count from public.sv_owner_attempts where user_id = p_user;
  if v_count >= 5 then return jsonb_build_object('allowed', false); end if;
  insert into public.sv_owner_attempts(user_id) values(p_user);
  return jsonb_build_object('allowed', true, 'epoch', v_epoch);
end $$;

create or replace function public.sv_owner_issue(p_user uuid, p_hash text, p_epoch bigint, p_old_hash text default null) returns jsonb
language plpgsql security invoker set search_path = pg_catalog, public as $$
declare v_grant public.sv_owner_grants; v_epoch bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('sv-owner:' || p_user::text, 0));
  select epoch into v_epoch from public.sv_owner_control where user_id = p_user;
  if v_epoch is null or v_epoch <> p_epoch then return null; end if;
  update public.sv_owner_grants set revoked_at = clock_timestamp()
    where user_id = p_user and token_hash = p_old_hash and revoked_at is null;
  insert into public.sv_owner_grants(user_id, token_hash) values(p_user, p_hash) returning * into v_grant;
  return to_jsonb(v_grant) - 'token_hash';
end $$;

create or replace function public.sv_owner_resolve(
  p_user uuid, p_hash text default null, p_touch boolean default false,
  p_id uuid default null, p_revision integer default null
) returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare v_grant public.sv_owner_grants; v_now timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended('sv-owner:' || p_user::text, 0));
  select * into v_grant from public.sv_owner_grants
    where user_id = p_user and (
      (p_hash is not null and token_hash = p_hash) or
      (p_hash is null and id = p_id and revision = p_revision and not p_touch)
    ) for update;
  if not found or v_grant.revoked_at is not null then return null; end if;
  v_now := clock_timestamp();
  if v_now >= v_grant.idle_locks_at then
    update public.sv_owner_grants set revoked_at = v_now where id = v_grant.id;
    return null;
  end if;
  if p_touch then
    update public.sv_owner_grants set last_activity_at = v_now, idle_locks_at = v_now + interval '30 minutes'
      where id = v_grant.id returning * into v_grant;
  end if;
  return to_jsonb(v_grant) - 'token_hash';
end $$;

create or replace function public.sv_owner_lock(p_user uuid) returns void
language plpgsql security invoker set search_path = pg_catalog, public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('sv-owner:' || p_user::text, 0));
  insert into public.sv_owner_control(user_id, epoch) values(p_user, 1)
    on conflict(user_id) do update set epoch = public.sv_owner_control.epoch + 1;
  update public.sv_owner_grants set revoked_at = clock_timestamp() where user_id = p_user and revoked_at is null;
end $$;
revoke all on function public.sv_owner_reserve_attempt(uuid), public.sv_owner_issue(uuid,text,bigint,text),
  public.sv_owner_resolve(uuid,text,boolean,uuid,integer), public.sv_owner_lock(uuid) from public, anon, authenticated;
grant execute on function public.sv_owner_reserve_attempt(uuid), public.sv_owner_issue(uuid,text,bigint,text),
  public.sv_owner_resolve(uuid,text,boolean,uuid,integer), public.sv_owner_lock(uuid) to service_role;
create table if not exists public.sv_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  created_at timestamptz not null default clock_timestamp()
);
create table if not exists public.sv_context_heads (
  project_id uuid not null references public.sv_projects(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  revision bigint not null default 0,
  primary key(project_id, conversation_id),
  unique(conversation_id)
);
create table if not exists public.sv_context_events (
  project_id uuid not null,
  conversation_id uuid not null,
  id uuid not null,
  sequence bigint not null,
  event jsonb not null,
  primary key(project_id, conversation_id, id),
  foreign key(project_id, conversation_id) references public.sv_context_heads on delete cascade
);
create table if not exists public.sv_cyber_modes (
  grant_id uuid not null references public.sv_owner_grants(id) on delete cascade,
  project_id uuid not null references public.sv_projects(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  primary key(grant_id, project_id, conversation_id)
);
alter table public.sv_projects enable row level security;
alter table public.sv_context_heads enable row level security;
alter table public.sv_context_events enable row level security;
alter table public.sv_cyber_modes enable row level security;
revoke all on public.sv_projects, public.sv_context_heads, public.sv_context_events, public.sv_cyber_modes from public, anon, authenticated;
grant all on public.sv_projects, public.sv_context_heads, public.sv_context_events, public.sv_cyber_modes to service_role;

create or replace function public.sv_context_read(p_user uuid, p_project uuid, p_conversation uuid)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare v_revision bigint; v_events jsonb; v_total integer;
begin
  if not exists(select 1 from public.sv_projects where id=p_project and user_id=p_user)
    or not exists(select 1 from public.conversations where id=p_conversation and user_id=p_user) then
    raise exception 'Context unavailable';
  end if;
  select revision into v_revision from public.sv_context_heads where project_id=p_project and conversation_id=p_conversation and user_id=p_user;
  with active as (
    select e.* from public.sv_context_events e where e.project_id=p_project and e.conversation_id=p_conversation
      and not exists(select 1 from public.sv_context_events newer where newer.project_id=e.project_id and newer.conversation_id=e.conversation_id and newer.event->>'supersedes'=e.id::text)
  ), bounded as (
    select * from active order by (event->>'field' in ('identity','address','os','environment','constraints','authorization')) desc, sequence desc limit 256
  )
  select coalesce((select jsonb_agg(event order by sequence) from bounded), '[]'::jsonb), (select count(*) from active)
    into v_events, v_total;
  return jsonb_build_object('revision', coalesce(v_revision,0), 'events', v_events, 'omitted', greatest(0,v_total-jsonb_array_length(v_events)));
end $$;
create or replace function public.sv_context_append(p_user uuid, p_project uuid, p_conversation uuid, p_revision bigint, p_events jsonb)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare v_head public.sv_context_heads; v_event jsonb; v_existing jsonb; v_seq bigint;
begin
  if not exists(select 1 from public.sv_projects where id=p_project and user_id=p_user)
    or not exists(select 1 from public.conversations where id=p_conversation and user_id=p_user) then raise exception 'Context unavailable'; end if;
  if jsonb_typeof(p_events)<>'array' or jsonb_array_length(p_events) not between 1 and 20 then raise exception 'Invalid events'; end if;
  perform pg_advisory_xact_lock(hashtextextended('sv-context:'||p_conversation::text,0));
  insert into public.sv_context_heads(project_id,conversation_id,user_id) values(p_project,p_conversation,p_user) on conflict do nothing;
  select * into v_head from public.sv_context_heads where project_id=p_project and conversation_id=p_conversation and user_id=p_user for update;
  if not found or v_head.revision<>p_revision then return jsonb_build_object('conflict',true); end if;
  v_seq := v_head.revision;
  for v_event in select value from jsonb_array_elements(p_events) loop
    select event into v_existing from public.sv_context_events where project_id=p_project and conversation_id=p_conversation and id=(v_event->>'id')::uuid;
    if found then
      if (v_existing #- '{source,observedAt}')<>(v_event #- '{source,observedAt}') then raise exception 'Evidence ID already exists'; end if;
      continue;
    end if;
    if v_event ? 'supersedes' and not exists(select 1 from public.sv_context_events where project_id=p_project and conversation_id=p_conversation and id=(v_event->>'supersedes')::uuid
      and event->>'entity'=v_event->>'entity' and event->>'field'=v_event->>'field') then raise exception 'Invalid correction'; end if;
    if octet_length(v_event::text)>24000 then raise exception 'Evidence too large'; end if;
    v_seq := v_seq+1;
    insert into public.sv_context_events values(p_project,p_conversation,(v_event->>'id')::uuid,v_seq,v_event);
  end loop;
  update public.sv_context_heads set revision=v_seq where project_id=p_project and conversation_id=p_conversation;
  return jsonb_build_object('revision',v_seq);
end $$;
create or replace function public.sv_context_delete(p_user uuid, p_project uuid, p_conversation uuid)
returns void language plpgsql security invoker set search_path = pg_catalog, public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('sv-context:'||p_conversation::text,0));
  if not exists(select 1 from public.sv_projects where id=p_project and user_id=p_user)
    or not exists(select 1 from public.conversations where id=p_conversation and user_id=p_user) then raise exception 'Context unavailable'; end if;
  delete from public.sv_cyber_modes where project_id=p_project and conversation_id=p_conversation;
  -- Keep the head/revision monotonic so old queued work cannot become valid again.
  delete from public.sv_context_events where project_id=p_project and conversation_id=p_conversation;
  update public.sv_context_heads set revision=revision+1 where project_id=p_project and conversation_id=p_conversation and user_id=p_user;
end $$;
revoke all on function public.sv_context_read(uuid,uuid,uuid), public.sv_context_append(uuid,uuid,uuid,bigint,jsonb), public.sv_context_delete(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.sv_context_read(uuid,uuid,uuid), public.sv_context_append(uuid,uuid,uuid,bigint,jsonb), public.sv_context_delete(uuid,uuid,uuid) to service_role;
-- Shared non-renewing authorization check. Locks serialize publication with
create or replace function public.sv_cyber_select(p_user uuid,p_grant uuid,p_revision bigint,p_project uuid,p_conversation uuid,p_enabled boolean)
returns void language plpgsql security invoker set search_path = pg_catalog, public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('sv-owner:'||p_user::text,0));
  perform pg_advisory_xact_lock(hashtextextended('sv-context:'||p_conversation::text,0));
  if not exists(select 1 from public.sv_owner_grants where id=p_grant and user_id=p_user and revision=p_revision and revoked_at is null and idle_locks_at>clock_timestamp())
    or not exists(select 1 from public.sv_projects where id=p_project and user_id=p_user)
    or not exists(select 1 from public.conversations where id=p_conversation and user_id=p_user) then raise exception 'Inactive owner scope'; end if;
  if p_enabled then insert into public.sv_cyber_modes values(p_grant,p_project,p_conversation) on conflict do nothing;
  else delete from public.sv_cyber_modes where grant_id=p_grant and project_id=p_project and conversation_id=p_conversation;
  end if;
end $$;
revoke all on function public.sv_cyber_select(uuid,uuid,bigint,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.sv_cyber_select(uuid,uuid,bigint,uuid,uuid,boolean) to service_role;

-- Shared non-renewing authorization check. Locks serialize publication with
-- sv lock and evidence deletion/correction, not just a stale worker snapshot.
create or replace function public.sv_cyber_binding_current(p_user uuid, p_binding jsonb, p_capability text)
returns boolean language plpgsql security invoker set search_path = pg_catalog, public as $$
declare v_project uuid; v_conversation uuid; v_revision bigint;
begin
  if p_binding is null or p_binding->>'version' is distinct from '1' or p_binding->>'capability' is distinct from p_capability
    or p_binding->>'userId' is distinct from p_user::text then return false; end if;
  v_project := (p_binding#>>'{context,projectId}')::uuid;
  v_conversation := (p_binding#>>'{context,conversationId}')::uuid;
  v_revision := (p_binding#>>'{context,revision}')::bigint;
  perform pg_advisory_xact_lock(hashtextextended('sv-owner:'||p_user::text,0));
  perform pg_advisory_xact_lock(hashtextextended('sv-context:'||v_conversation::text,0));
  return exists(select 1 from public.sv_owner_grants g
    join public.sv_cyber_modes m on m.grant_id=g.id
    join public.sv_projects p on p.id=m.project_id and p.user_id=p_user
    join public.conversations c on c.id=m.conversation_id and c.user_id=p_user
    where g.id=(p_binding->>'grantId')::uuid and g.user_id=p_user
      and g.revision=(p_binding->>'grantRevision')::bigint and g.revoked_at is null and g.idle_locks_at>clock_timestamp()
      and m.project_id=v_project and m.conversation_id=v_conversation)
    and coalesce((select revision from public.sv_context_heads where project_id=v_project and conversation_id=v_conversation and user_id=p_user),0)=v_revision;
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end $$;

revoke all on function public.sv_cyber_binding_current(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.sv_cyber_binding_current(uuid,jsonb,text) to service_role;
create index if not exists sv_projects_user_created on public.sv_projects(user_id, created_at desc);
create index if not exists sv_context_heads_user on public.sv_context_heads(user_id);
create index if not exists sv_cyber_modes_project on public.sv_cyber_modes(project_id);
create index if not exists sv_cyber_modes_conversation on public.sv_cyber_modes(conversation_id);
notify pgrst, 'reload schema';

commit;
