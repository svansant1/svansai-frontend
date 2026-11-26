-- Run inside a transaction with svans.verify_user set to an existing approved account.
-- Roll back the transaction after this block; do not retain verification records.
do $verification$
declare
  u uuid := current_setting('svans.verify_user')::uuid;
  other_user uuid := gen_random_uuid();
  p uuid := gen_random_uuid(); p2 uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  e uuid := gen_random_uuid(); grant_id uuid; token_hash text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  result jsonb; reservation jsonb; issued jsonb; before_read jsonb; after_read jsonb; binding jsonb;
  denied boolean := false;
begin
  if not exists(select 1 from auth.users where id=u) then raise exception 'Verification user is unavailable'; end if;
  set local role service_role;
  insert into public.sv_projects(id,user_id,name) values(p,u,'__svans_transaction_test__'),(p2,u,'__svans_other_project_test__');
  insert into public.conversations(id,user_id,title) values(c,u,'__svans_transaction_test__');
  result := public.sv_context_append(u,p,c,0,jsonb_build_array(jsonb_build_object(
    'id',e,'entity','session','field','evidence','value','Verification-only reported evidence',
    'source',jsonb_build_object('kind','user_report','observedAt',clock_timestamp()))));
  if result->>'revision' is distinct from '1' then raise exception 'Context append failed'; end if;
  result := public.sv_context_read(u,p,c);
  if result->>'revision' is distinct from '1' or jsonb_array_length(result->'events')<>1 then raise exception 'Context read failed'; end if;
  result := public.sv_context_append(u,p,c,0,'[]'::jsonb || jsonb_build_object('id',gen_random_uuid()));
  if result->>'conflict' is distinct from 'true' then raise exception 'Stale revision accepted'; end if;
  begin perform public.sv_context_read(other_user,p,c);
  exception when raise_exception then denied := true;
  end;
  if not denied then raise exception 'Wrong user read accepted'; end if;
  result := public.sv_context_append(u,p2,c,0,jsonb_build_array(jsonb_build_object('id',gen_random_uuid())));
  if result->>'conflict' is distinct from 'true' then raise exception 'Conversation rebound to another project'; end if;

  reservation := public.sv_owner_reserve_attempt(u);
  if reservation->>'allowed' is distinct from 'true' then raise exception 'Owner verification is rate-limited'; end if;
  issued := public.sv_owner_issue(u,token_hash,(reservation->>'epoch')::bigint);
  if issued is null or issued ? 'token_hash' then raise exception 'Owner grant issue/redaction failed'; end if;
  grant_id := (issued->>'id')::uuid;
  before_read := public.sv_owner_resolve(u,null,false,grant_id,1);
  after_read := public.sv_owner_resolve(u,null,false,grant_id,1);
  if before_read is null or after_read is null or before_read->>'idle_locks_at' is distinct from after_read->>'idle_locks_at' then raise exception 'Read renewed idle deadline'; end if;
  if public.sv_owner_resolve(other_user,null,false,grant_id,1) is not null or public.sv_owner_resolve(u,null,false,grant_id,2) is not null then raise exception 'Wrong owner/revision accepted'; end if;
  after_read := public.sv_owner_resolve(u,token_hash,true,null,null);
  if extract(epoch from ((after_read->>'idle_locks_at')::timestamptz-clock_timestamp())) not between 1799 and 1801 then raise exception 'Activity did not set thirty-minute deadline'; end if;
  perform public.sv_cyber_select(u,grant_id,1,p,c,true);
  binding := jsonb_build_object('version',1,'capability','generation','userId',u,'grantId',grant_id,'grantRevision',1,
    'context',jsonb_build_object('projectId',p,'conversationId',c,'revision',1));
  if public.sv_cyber_binding_current(u,binding,'generation') is not true then raise exception 'Current binding rejected'; end if;
  if public.sv_cyber_binding_current(other_user,binding,'generation') is not false then raise exception 'Foreign binding accepted'; end if;
  perform public.sv_context_delete(u,p,c);
  result := public.sv_context_read(u,p,c);
  if result->>'revision' is distinct from '2' or jsonb_array_length(result->'events')<>0 then raise exception 'Context deletion revision incorrect'; end if;
  if public.sv_cyber_binding_current(u,binding,'generation') is not false then raise exception 'Deleted-context binding stayed active'; end if;

  update public.sv_owner_grants set idle_locks_at=clock_timestamp()-interval '1 second' where id=grant_id;
  if public.sv_owner_resolve(u,null,false,grant_id,1) is not null then raise exception 'Idle-expired grant accepted'; end if;
  issued := public.sv_owner_issue(u,replace(gen_random_uuid()::text || gen_random_uuid()::text,'-',''),(reservation->>'epoch')::bigint);
  grant_id := (issued->>'id')::uuid;
  perform public.sv_owner_lock(u);
  if public.sv_owner_resolve(u,null,false,grant_id,1) is not null then raise exception 'Manually locked grant accepted'; end if;
  if public.sv_owner_issue(u,token_hash,(reservation->>'epoch')::bigint) is not null then raise exception 'Stale unlock epoch accepted'; end if;
  reset role;
end $verification$;
