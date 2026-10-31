-- Row Level Security, storage policies and RPC functions.
-- Principle: a user can only see/modify rows whose owner_id = auth.uid(). Extracted metadata is written
-- exclusively by the processing worker (service role / direct DB connection), so clients get read + delete only.

alter table public.profiles enable row level security;
alter table public.user_preferences enable row level security;
alter table public.user_ai_credentials enable row level security;
alter table public.database_projects enable row level security;
alter table public.database_versions enable row level security;
alter table public.database_import_jobs enable row level security;
alter table public.database_objects enable row level security;
alter table public.database_columns enable row level security;
alter table public.database_relationships enable row level security;
alter table public.database_indexes enable row level security;
alter table public.database_constraints enable row level security;
alter table public.database_dependencies enable row level security;
alter table public.schema_comparisons enable row level security;
alter table public.migration_plans enable row level security;
alter table public.sql_scripts enable row level security;
alter table public.sql_script_versions enable row level security;
alter table public.sql_analyses enable row level security;
alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;
alter table public.ai_requests enable row level security;
alter table public.query_history enable row level security;
alter table public.audit_logs enable row level security;
alter table public.rate_limits enable row level security;

-- profiles ------------------------------------------------------------------
create policy profiles_select_own on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- user_preferences ----------------------------------------------------------
create policy user_preferences_select_own on public.user_preferences for select to authenticated
  using (user_id = (select auth.uid()));
create policy user_preferences_insert_own on public.user_preferences for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy user_preferences_update_own on public.user_preferences for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- user_ai_credentials: RLS on, NO policies. Only the server (service role) may touch it.
revoke all on public.user_ai_credentials from anon, authenticated;

-- database_projects -----------------------------------------------------------
create policy database_projects_select_own on public.database_projects for select to authenticated
  using (owner_id = (select auth.uid()));
create policy database_projects_insert_own on public.database_projects for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy database_projects_update_own on public.database_projects for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy database_projects_delete_own on public.database_projects for delete to authenticated
  using (owner_id = (select auth.uid()));

-- database_versions -----------------------------------------------------------
create policy database_versions_select_own on public.database_versions for select to authenticated
  using (owner_id = (select auth.uid()));
create policy database_versions_insert_own on public.database_versions for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.database_projects p where p.id = project_id and p.owner_id = (select auth.uid()))
  );
create policy database_versions_update_own on public.database_versions for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy database_versions_delete_own on public.database_versions for delete to authenticated
  using (owner_id = (select auth.uid()));
-- Clients may only rename a version; status/summary are worker-owned.
revoke update on public.database_versions from authenticated;
grant update (label) on public.database_versions to authenticated;

-- database_import_jobs --------------------------------------------------------
create policy database_import_jobs_select_own on public.database_import_jobs for select to authenticated
  using (owner_id = (select auth.uid()));
create policy database_import_jobs_insert_own on public.database_import_jobs for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and status = 'pending'
    and exists (select 1 from public.database_versions v where v.id = version_id and v.owner_id = (select auth.uid()))
  );
create policy database_import_jobs_delete_own on public.database_import_jobs for delete to authenticated
  using (owner_id = (select auth.uid()));

-- extracted metadata: read + delete only ---------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'database_objects', 'database_columns', 'database_relationships',
    'database_indexes', 'database_constraints', 'database_dependencies'
  ]
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (owner_id = (select auth.uid()))',
      t || '_select_own', t
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (owner_id = (select auth.uid()))',
      t || '_delete_own', t
    );
  end loop;
end $$;

-- schema_comparisons / migration_plans ----------------------------------------
create policy schema_comparisons_select_own on public.schema_comparisons for select to authenticated
  using (owner_id = (select auth.uid()));
create policy schema_comparisons_insert_own on public.schema_comparisons for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.database_versions v where v.id = base_version_id and v.owner_id = (select auth.uid()) and v.project_id = schema_comparisons.project_id)
    and exists (select 1 from public.database_versions v where v.id = target_version_id and v.owner_id = (select auth.uid()) and v.project_id = schema_comparisons.project_id)
  );
create policy schema_comparisons_delete_own on public.schema_comparisons for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy migration_plans_select_own on public.migration_plans for select to authenticated
  using (owner_id = (select auth.uid()));
create policy migration_plans_insert_own on public.migration_plans for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.database_versions v where v.id = source_version_id and v.owner_id = (select auth.uid()) and v.project_id = migration_plans.project_id)
    and exists (select 1 from public.database_versions v where v.id = target_version_id and v.owner_id = (select auth.uid()) and v.project_id = migration_plans.project_id)
  );
create policy migration_plans_update_own on public.migration_plans for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy migration_plans_delete_own on public.migration_plans for delete to authenticated
  using (owner_id = (select auth.uid()));

-- sql_scripts / versions / analyses --------------------------------------------
create policy sql_scripts_select_own on public.sql_scripts for select to authenticated
  using (owner_id = (select auth.uid()));
create policy sql_scripts_insert_own on public.sql_scripts for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and (project_id is null or exists (select 1 from public.database_projects p where p.id = project_id and p.owner_id = (select auth.uid())))
  );
create policy sql_scripts_update_own on public.sql_scripts for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and (project_id is null or exists (select 1 from public.database_projects p where p.id = project_id and p.owner_id = (select auth.uid())))
  );
create policy sql_scripts_delete_own on public.sql_scripts for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy sql_script_versions_select_own on public.sql_script_versions for select to authenticated
  using (owner_id = (select auth.uid()));
create policy sql_script_versions_insert_own on public.sql_script_versions for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.sql_scripts s where s.id = script_id and s.owner_id = (select auth.uid()))
  );
create policy sql_script_versions_delete_own on public.sql_script_versions for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy sql_analyses_select_own on public.sql_analyses for select to authenticated
  using (owner_id = (select auth.uid()));
create policy sql_analyses_insert_own on public.sql_analyses for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and (project_id is null or exists (select 1 from public.database_projects p where p.id = project_id and p.owner_id = (select auth.uid())))
  );
create policy sql_analyses_delete_own on public.sql_analyses for delete to authenticated
  using (owner_id = (select auth.uid()));

-- AI ------------------------------------------------------------------------
create policy ai_conversations_select_own on public.ai_conversations for select to authenticated
  using (owner_id = (select auth.uid()));
create policy ai_conversations_insert_own on public.ai_conversations for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and (project_id is null or exists (select 1 from public.database_projects p where p.id = project_id and p.owner_id = (select auth.uid())))
  );
create policy ai_conversations_update_own on public.ai_conversations for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy ai_conversations_delete_own on public.ai_conversations for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy ai_messages_select_own on public.ai_messages for select to authenticated
  using (owner_id = (select auth.uid()));
create policy ai_messages_insert_own on public.ai_messages for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.ai_conversations c where c.id = conversation_id and c.owner_id = (select auth.uid()))
  );
create policy ai_messages_delete_own on public.ai_messages for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy ai_requests_select_own on public.ai_requests for select to authenticated
  using (owner_id = (select auth.uid()));
create policy ai_requests_insert_own on public.ai_requests for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy query_history_select_own on public.query_history for select to authenticated
  using (owner_id = (select auth.uid()));
create policy query_history_insert_own on public.query_history for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and (project_id is null or exists (select 1 from public.database_projects p where p.id = project_id and p.owner_id = (select auth.uid())))
  );
create policy query_history_delete_own on public.query_history for delete to authenticated
  using (owner_id = (select auth.uid()));

-- audit_logs: users can read their own trail, nobody can edit/delete it from the client.
create policy audit_logs_select_own on public.audit_logs for select to authenticated
  using (owner_id = (select auth.uid()));
create policy audit_logs_insert_own on public.audit_logs for insert to authenticated
  with check (owner_id = (select auth.uid()));

-- rate_limits: no client policies; accessed through check_rate_limit() only.
revoke all on public.rate_limits from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Storage: private bucket, per-user + per-project path prefix
-- Path convention: {user_id}/{project_id}/{uuid}-{sanitised file name}
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('schema-uploads', 'schema-uploads', false, 52428800, null)
on conflict (id) do update set public = false, file_size_limit = 52428800;

create policy schema_uploads_select_own on storage.objects for select to authenticated
  using (bucket_id = 'schema-uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy schema_uploads_insert_own on storage.objects for insert to authenticated
  with check (
    bucket_id = 'schema-uploads'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (storage.foldername(name))[2] in (
      select p.id::text from public.database_projects p where p.owner_id = (select auth.uid())
    )
  );

create policy schema_uploads_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'schema-uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------------------
-- RPC: create a schema version + import job atomically (RLS applies: security invoker)
-- ---------------------------------------------------------------------------
create or replace function public.create_schema_version_and_job(
  p_project_id uuid,
  p_label text,
  p_source_type text,
  p_file_name text,
  p_file_size bigint,
  p_storage_path text,
  p_sha256 text default null
)
returns table (version_id uuid, job_id uuid, version_number int)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_next int;
  v_version uuid;
  v_job uuid;
begin
  if v_owner is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not exists (select 1 from public.database_projects p where p.id = p_project_id and p.owner_id = v_owner) then
    raise exception 'project not found' using errcode = '42501';
  end if;
  -- the object path must live under the caller's own prefix
  if split_part(p_storage_path, '/', 1) <> v_owner::text or split_part(p_storage_path, '/', 2) <> p_project_id::text then
    raise exception 'invalid storage path' using errcode = '42501';
  end if;

  select coalesce(max(v.version_number), 0) + 1 into v_next
  from public.database_versions v where v.project_id = p_project_id;

  insert into public.database_versions (owner_id, project_id, version_number, label, source_type, source_file_name, storage_path, source_sha256)
  values (v_owner, p_project_id, v_next, nullif(trim(p_label), ''), p_source_type, p_file_name, p_storage_path, p_sha256)
  returning id into v_version;

  insert into public.database_import_jobs (owner_id, project_id, version_id, file_name, file_size, file_type, storage_path, source_sha256)
  values (v_owner, p_project_id, v_version, p_file_name, p_file_size, p_source_type, p_storage_path, p_sha256)
  returning id into v_job;

  insert into public.audit_logs (owner_id, action, entity_type, entity_id, details)
  values (v_owner, 'schema_import.created', 'database_version', v_version,
          jsonb_build_object('file_name', p_file_name, 'file_size', p_file_size, 'source_type', p_source_type));

  return query select v_version, v_job, v_next;
end;
$$;

-- Retry a failed job (owner only).
create or replace function public.retry_import_job(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
begin
  update public.database_import_jobs
     set status = 'pending', attempts = 0, error_code = null, error_message = null,
         progress = 0, stage = null, locked_at = null, locked_by = null, finished_at = null
   where id = p_job_id and owner_id = v_owner and status = 'failed';
  if not found then
    raise exception 'job not found or not retryable' using errcode = '42501';
  end if;
  update public.database_versions set status = 'pending'
   where id = (select version_id from public.database_import_jobs where id = p_job_id);
end;
$$;

-- Fixed-window rate limiter keyed by the authenticated user.
create or replace function public.check_rate_limit(p_bucket text, p_limit int, p_window_seconds int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_window timestamptz;
  v_hits int;
begin
  if v_user is null then
    return false;
  end if;
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limits (bucket_key, window_start, hits)
  values (v_user::text || ':' || p_bucket, v_window, 1)
  on conflict (bucket_key, window_start) do update set hits = public.rate_limits.hits + 1
  returning hits into v_hits;
  -- opportunistic cleanup of old windows
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;
  return v_hits <= p_limit;
end;
$$;

-- Dashboard statistics: counted from the latest successfully imported version of every project
-- so repeated imports of the same database never inflate table/procedure totals.
create or replace function public.dashboard_stats()
returns jsonb
language sql
security invoker
stable
set search_path = ''
as $$
  with latest as (
    select distinct on (v.project_id) v.id
    from public.database_versions v
    where v.status in ('ready', 'ready_with_warnings')
    order by v.project_id, v.version_number desc
  )
  select jsonb_build_object(
    'projects', (select count(*) from public.database_projects),
    'schema_versions', (select count(*) from public.database_versions where status in ('ready', 'ready_with_warnings')),
    'tables', (select count(*) from public.database_objects o where o.object_type = 'table' and o.version_id in (select id from latest)),
    'procedures', (select count(*) from public.database_objects o where o.object_type = 'procedure' and o.version_id in (select id from latest)),
    'scripts', (select count(*) from public.sql_scripts),
    'analyses', (select count(*) from public.sql_analyses),
    'ai_interactions', (select count(*) from public.ai_requests where status = 'success')
  );
$$;

-- ---------------------------------------------------------------------------
-- Worker-only functions. Never callable from the browser.
-- ---------------------------------------------------------------------------
create or replace function public.claim_import_job(p_worker_id text, p_stale_seconds int default 600)
returns setof public.database_import_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- jobs whose worker died and exhausted retries are failed, not retried forever
  update public.database_import_jobs
     set status = 'failed', error_code = 'worker_timeout',
         error_message = 'The processing worker stopped responding and the retry limit was reached.',
         finished_at = now()
   where status in ('validating', 'processing')
     and locked_at < now() - make_interval(secs => p_stale_seconds)
     and attempts >= max_attempts;

  select j.id into v_id
    from public.database_import_jobs j
   where j.attempts < j.max_attempts
     and (
       j.status = 'pending'
       or (j.status in ('validating', 'processing') and j.locked_at < now() - make_interval(secs => p_stale_seconds))
     )
   order by j.created_at
   for update skip locked
   limit 1;

  if v_id is null then
    return;
  end if;

  return query
    update public.database_import_jobs
       set status = 'validating', stage = 'Validating file', progress = 5,
           attempts = attempts + 1, locked_at = now(), locked_by = p_worker_id,
           started_at = coalesce(started_at, now()), error_code = null, error_message = null
     where id = v_id
     returning *;
end;
$$;

revoke all on function public.claim_import_job(text, int) from public, anon, authenticated;
grant execute on function public.claim_import_job(text, int) to service_role;

revoke all on function public.retry_import_job(uuid) from public, anon;
grant execute on function public.retry_import_job(uuid) to authenticated;
revoke all on function public.check_rate_limit(text, int, int) from public, anon;
grant execute on function public.check_rate_limit(text, int, int) to authenticated;
revoke all on function public.create_schema_version_and_job(uuid, text, text, text, bigint, text, text) from public, anon;
grant execute on function public.create_schema_version_and_job(uuid, text, text, text, bigint, text, text) to authenticated;
revoke all on function public.dashboard_stats() from public, anon;
grant execute on function public.dashboard_stats() to authenticated;
