-- SOURCE ONLY: apply in acceptance AFTER personalization_schema.sql,
-- lab_runtime.sql and cyber_context_runtime.sql. Never applied by app startup.
begin;
alter table public.svans_jobs drop constraint if exists svans_jobs_kind_check;
alter table public.svans_jobs add constraint svans_jobs_kind_check check(kind in ('generation','lab','cyber'));

create or replace function public.svans_enqueue_cyber(p_user uuid, p_payload jsonb, p_hash text, p_key text)
returns setof public.svans_jobs language plpgsql security invoker set search_path = pg_catalog, public as $$
declare job public.svans_jobs;
begin
  if public.sv_cyber_binding_current(p_user,p_payload->'binding','cyber.exercise') is not true then raise exception 'Inactive authorization'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
  if p_hash !~ '^[a-f0-9]{64}$' or octet_length(p_payload::text)>32768 or length(p_key) not between 16 and 100 or p_key !~ '^[A-Za-z0-9_-]+$' then raise exception 'Invalid proposal'; end if;
  select * into job from public.svans_jobs where user_id=p_user and idempotency_key=p_key;
  if found then
    if job.kind<>'cyber' or job.payload_hash<>p_hash then raise exception 'Idempotency mismatch'; end if;
    return next job; return;
  end if;
  with expired as (
    update public.svans_jobs set state='cancelled',error_code='APPROVAL_EXPIRED',updated_at=now()
    where user_id=p_user and kind in ('lab','cyber') and state in ('waiting_approval','queued') and approval_expires_at<=now() returning id
  ) insert into public.svans_job_events(job_id,state,detail) select id,'cancelled','Approval expired.' from expired;
  if (select count(*) from public.svans_jobs where user_id=p_user and state in ('waiting_approval','queued','running'))>=5
    or (select count(*) from public.svans_jobs where user_id=p_user and kind in ('lab','cyber') and state in ('waiting_approval','queued','running'))>=3 then raise exception 'Shared active run limit'; end if;
  insert into public.svans_jobs(user_id,kind,payload,payload_hash,idempotency_key,state,max_attempts,approval_expires_at)
    values(p_user,'cyber',p_payload,p_hash,p_key,'waiting_approval',1,now()+interval '15 minutes') returning * into job;
  insert into public.svans_job_events(job_id,state,detail) values(job.id,'waiting_approval','Fixed fixture proposal saved. Nothing executed.');
  return next job;
end $$;
create or replace function public.svans_approve_cyber(p_user uuid, p_id uuid, p_hash text)
returns void language plpgsql security invoker set search_path = pg_catalog, public as $$
declare job public.svans_jobs;
begin
  select * into job from public.svans_jobs where id=p_id and user_id=p_user and kind='cyber';
  if not found or public.sv_cyber_binding_current(p_user,job.payload->'binding','cyber.exercise') is not true then raise exception 'Inactive authorization'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
  select * into job from public.svans_jobs where id=p_id and user_id=p_user and kind='cyber' for update;
  if job.payload_hash<>p_hash or job.state<>'waiting_approval' or job.cancel_requested or job.approval_expires_at<=now() then raise exception 'Approval expired or changed'; end if;
  if (select count(*) from public.svans_jobs where user_id=p_user and kind in ('lab','cyber') and approved_at>now()-interval '24 hours')>=20 then raise exception 'Shared daily run limit'; end if;
  update public.svans_jobs set state='queued',approved_at=now(),updated_at=now() where id=p_id;
  insert into public.svans_job_events(job_id,state,detail) values(p_id,'approved','Owner approved catalog payload '||p_hash);
end $$;
create or replace function public.svans_claim_cyber(p_worker uuid)
returns setof public.svans_jobs language plpgsql security invoker set search_path = pg_catalog, public as $$
declare job public.svans_jobs;
begin
  with lost as (
    update public.svans_jobs set state='indeterminate',error_code='CYBER_LEASE_LOST',lease_token=null,lease_until=null,updated_at=now()
    where kind='cyber' and state='running' and lease_until<now() returning id
  ) insert into public.svans_job_events(job_id,state,detail) select id,'indeterminate','Supervisor lost; do not replay. Inspect fixture cleanup.' from lost;
  with expired as (
    update public.svans_jobs set state='cancelled',error_code='APPROVAL_EXPIRED',updated_at=now()
    where kind='cyber' and state in ('waiting_approval','queued') and approval_expires_at<=now() returning id
  ) insert into public.svans_job_events(job_id,state,detail) select id,'cancelled','Approval expired before start.' from expired;
  select * into job from public.svans_jobs where kind='cyber' and state='queued' and attempts=0
    and approved_at is not null and approval_expires_at>now() and not cancel_requested order by created_at for update skip locked limit 1;
  if not found then return; end if;
  update public.svans_jobs set state='running',attempts=1,lease_token=gen_random_uuid(),worker_id=p_worker,
    lease_until=now()+interval '60 seconds',updated_at=now() where id=job.id returning * into job;
  return next job;
end $$;
create or replace function public.svans_finish_cyber(p_id uuid, p_lease uuid, p_result jsonb, p_error text, p_unknown boolean)
returns void language plpgsql security invoker set search_path = pg_catalog, public as $$
declare job public.svans_jobs; valid boolean; v_event jsonb; v_append jsonb;
begin
  select * into job from public.svans_jobs where id=p_id and kind='cyber';
  if not found then raise exception 'Run unavailable'; end if;
  valid := public.sv_cyber_binding_current(job.user_id,job.payload->'binding','cyber.exercise');
  select * into job from public.svans_jobs where id=p_id and kind='cyber' and state='running'
    and lease_token=p_lease and lease_until>now() for update;
  if not found then raise exception 'Run lease inactive; reconcile outcome'; end if;
  if p_result is not null and octet_length(p_result::text)>262144 then raise exception 'Report too large'; end if;
  if valid is not true then p_result:=null; p_error:='OWNER_LOCKED_OR_CONTEXT_CHANGED'; end if;
  if job.cancel_requested then p_result:=null; p_error:='CANCELLED'; end if;
  if p_result is not null and not p_unknown then
    -- This record is generated only from a connected worker report, not an LLM claim.
    v_event := jsonb_build_object('id',p_id,'entity','session','field','finding',
      'value',left('ISOLATED TRAINING FIXTURE ONLY. '||coalesce(p_result#>>'{cyber,targetDescription}','')||E'\n'||
        coalesce(p_result#>>'{cyber,status}','unknown')||E'\n'||coalesce(p_result#>>'{cyber,stdout}',''),12000),
      'source',jsonb_build_object('kind','tool_observation','messageId',p_id,'observedAt',clock_timestamp()));
    v_append := public.sv_context_append(job.user_id,(job.payload#>>'{binding,context,projectId}')::uuid,
      (job.payload#>>'{binding,context,conversationId}')::uuid,(job.payload#>>'{binding,context,revision}')::bigint,jsonb_build_array(v_event));
    if v_append->>'conflict'='true' then p_result:=null; p_error:='CONTEXT_CHANGED'; end if;
  end if;
  update public.svans_jobs set state=case when p_unknown then 'indeterminate' when job.cancel_requested then 'cancelled' when p_error is not null then 'failed' else 'succeeded' end,
    result=p_result,error_code=case when p_unknown then 'CLEANUP_OR_OUTCOME_UNKNOWN' else p_error end,
    lease_token=null,lease_until=null,updated_at=now() where id=p_id;
  insert into public.svans_job_events(job_id,state,detail) select id,state,coalesce(error_code,'Fixture report saved. No real device scanned.') from public.svans_jobs where id=p_id;
end $$;
revoke all on function public.svans_enqueue_cyber(uuid,jsonb,text,text),public.svans_approve_cyber(uuid,uuid,text),
  public.svans_claim_cyber(uuid),public.svans_finish_cyber(uuid,uuid,jsonb,text,boolean) from public,anon,authenticated;
grant execute on function public.svans_enqueue_cyber(uuid,jsonb,text,text),public.svans_approve_cyber(uuid,uuid,text),
  public.svans_claim_cyber(uuid),public.svans_finish_cyber(uuid,uuid,jsonb,text,boolean) to service_role;
commit;
