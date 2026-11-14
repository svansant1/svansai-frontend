-- SOURCE ONLY. Apply after personalization_schema.sql in the later acceptance
-- environment. No database has been changed by writing this file.
-- All mutations are service-role only; owner read RLS comes from svans_jobs.

create or replace function public.svans_enqueue_lab(p_user uuid, p_payload jsonb, p_hash text, p_key text)
returns setof public.svans_jobs language plpgsql security invoker set search_path = '' as $$
declare existing public.svans_jobs; inserted public.svans_jobs;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user::text,0));
  if p_hash !~ '^[a-f0-9]{64}$' or octet_length(p_payload::text) > 262144 or
      length(p_key) not between 16 and 100 or p_key !~ '^[A-Za-z0-9_-]+$' then raise exception 'Invalid request'; end if;
  select * into existing from public.svans_jobs where user_id=p_user and idempotency_key=p_key;
  if found then
    if existing.kind <> 'lab' or existing.payload_hash <> p_hash then raise exception 'Idempotency mismatch'; end if;
    return next existing; return;
  end if;
  with expired as (
    update public.svans_jobs set state='cancelled',error_code='APPROVAL_EXPIRED',updated_at=now()
    where user_id=p_user and kind='lab' and state in ('waiting_approval','queued') and approval_expires_at <= now() returning id
  ) insert into public.svans_job_events(job_id,state,detail) select id,'cancelled','Approval window expired.' from expired;
  if (select count(*) from public.svans_jobs where user_id=p_user and state in ('waiting_approval','queued','running')) >= 5 or
     (select count(*) from public.svans_jobs where user_id=p_user and kind in ('lab','cyber') and state in ('waiting_approval','queued','running')) >= 3 then
    raise exception 'Active job limit'; end if;
  insert into public.svans_jobs(user_id,kind,payload,payload_hash,idempotency_key,state,max_attempts,approval_expires_at)
    values(p_user,'lab',p_payload,p_hash,p_key,'waiting_approval',1,now()+interval '15 minutes') returning * into inserted;
  insert into public.svans_job_events(job_id,state,detail) values(inserted.id,'waiting_approval','Snapshot saved. No code has run; explicit approval required.');
  return next inserted;
end $$;

create or replace function public.svans_decide_lab(p_user uuid, p_id uuid, p_hash text, p_approve boolean)
returns void language plpgsql security invoker set search_path = '' as $$
declare job public.svans_jobs;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user::text,0));
  select * into job from public.svans_jobs where id=p_id and user_id=p_user and kind='lab' for update;
  if not found or job.payload_hash <> p_hash or job.state <> 'waiting_approval' or
      job.cancel_requested or job.approval_expires_at <= now() then raise exception 'Approval inactive'; end if;
  -- Reserve the rolling daily run budget atomically; a cancelled reservation is not refunded.
  if p_approve and (select count(*) from public.svans_jobs where user_id=p_user and kind in ('lab','cyber') and approved_at > now()-interval '24 hours') >= 20 then
    raise exception 'Daily lab budget exhausted'; end if;
  update public.svans_jobs set state=case when p_approve then 'queued' else 'cancelled' end,
    approved_at=case when p_approve then now() else null end, cancel_requested=not p_approve, updated_at=now()
    where id=p_id;
  insert into public.svans_job_events(job_id,state,detail)
    values(p_id,case when p_approve then 'approved' else 'rejected' end,
      'Owner '||p_user::text||case when p_approve then ' approved snapshot ' else ' rejected snapshot ' end||p_hash);
end $$;

create or replace function public.svans_claim_lab(p_worker uuid)
returns setof public.svans_jobs language plpgsql security invoker set search_path = '' as $$
declare claimed public.svans_jobs;
begin
  -- Unknown outcomes are terminal here, not automatically retried on another host.
  with lost as (
    update public.svans_jobs set state='indeterminate',error_code='LAB_LEASE_LOST',lease_token=null,lease_until=null,updated_at=now()
    where kind='lab' and state='running' and lease_until < now() returning id
  ) insert into public.svans_job_events(job_id,state,detail) select id,'indeterminate','Worker lease lost. Inspect cleanup and logs; automatic replay prohibited.' from lost;
  with expired as (
    update public.svans_jobs set state='cancelled',error_code='APPROVAL_EXPIRED',updated_at=now()
    where kind='lab' and state in ('waiting_approval','queued') and approval_expires_at <= now() returning id
  ) insert into public.svans_job_events(job_id,state,detail) select id,'cancelled','Approval window expired before start.' from expired;
  select * into claimed from public.svans_jobs
    where kind='lab' and state='queued' and approved_at is not null and approval_expires_at>now() and not cancel_requested and attempts=0
    order by created_at for update skip locked limit 1;
  if not found then return; end if;
  update public.svans_jobs set state='running',attempts=1,worker_id=p_worker,lease_token=gen_random_uuid(),
    lease_until=now()+interval '60 seconds',updated_at=now() where id=claimed.id returning * into claimed;
  insert into public.svans_job_events(job_id,state,detail) values(claimed.id,'running','Worker claimed the exact approved snapshot.');
  return next claimed;
end $$;

create or replace function public.svans_finish_lab(p_id uuid, p_lease uuid, p_result jsonb, p_error text, p_unknown boolean)
returns void language plpgsql security invoker set search_path = '' as $$
declare finished public.svans_jobs;
begin
  if p_result is not null and octet_length(p_result::text)>262144 then raise exception 'Result too large'; end if;
  update public.svans_jobs set
    state=case when p_unknown then 'indeterminate' when cancel_requested then 'cancelled' when p_error is not null then 'failed' else 'succeeded' end,
    result=p_result,error_code=case when p_unknown then 'CLEANUP_OR_OUTCOME_UNKNOWN' when cancel_requested then 'CANCELLED' else p_error end,
    lease_token=null,lease_until=null,updated_at=now()
    where id=p_id and kind='lab' and state='running' and lease_token=p_lease and lease_until>now() returning * into finished;
  if not found then raise exception 'Lab lease inactive'; end if;
  insert into public.svans_job_events(job_id,state,detail) values(p_id,finished.state,coalesce(finished.error_code,'Execution report saved; this is not owner approval of a patch.'));
end $$;

revoke all on function public.svans_enqueue_lab(uuid,jsonb,text,text), public.svans_decide_lab(uuid,uuid,text,boolean),
  public.svans_claim_lab(uuid), public.svans_finish_lab(uuid,uuid,jsonb,text,boolean) from public, anon, authenticated;
grant execute on function public.svans_enqueue_lab(uuid,jsonb,text,text), public.svans_decide_lab(uuid,uuid,text,boolean),
  public.svans_claim_lab(uuid), public.svans_finish_lab(uuid,uuid,jsonb,text,boolean) to service_role;
