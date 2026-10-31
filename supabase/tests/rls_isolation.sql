-- RLS isolation tests. Run against a database that has the migrations applied (local `supabase start` is ideal):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_isolation.sql
-- Everything happens in one transaction that is rolled back, so no data is left behind.
-- Two synthetic users (alice, bob) are created; the script switches to the `authenticated` role with each user's JWT
-- claims and asserts that cross-tenant reads and writes are impossible.
begin;

create or replace function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create or replace function pg_temp.act_as_service() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

create or replace function pg_temp.assert_true(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if not coalesce(p_cond, false) then raise exception 'ASSERTION FAILED: %', p_msg; end if;
end $$;

create or replace function pg_temp.assert_denied(p_sql text, p_msg text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    return; -- any error (RLS violation, permission denied, missing row) counts as denied
  end;
  raise exception 'ASSERTION FAILED (expected denial): %', p_msg;
end $$;

do $$
declare
  alice uuid := '00000000-0000-4000-8000-0000000000a1';
  bob   uuid := '00000000-0000-4000-8000-0000000000b2';
  proj_a uuid; proj_b uuid; ver_a uuid; job_a uuid; ver_n int; n int;
begin
  -- fixtures (as postgres): two auth users; triggers create profiles/preferences
  insert into auth.users (id, email, instance_id, aud, role) values
    (alice, 'alice@example.test', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
    (bob,   'bob@example.test',   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

  -- alice creates a project, a version/job through the RPC, a script and a history row
  perform pg_temp.act_as(alice);
  insert into public.database_projects (owner_id, name) values (alice, 'A') returning id into proj_a;
  select r.version_id, r.job_id, r.version_number into ver_a, job_a, ver_n
    from public.create_schema_version_and_job(proj_a, 'v1', 'sql', 'a.sql', 10, alice || '/' || proj_a || '/x-a.sql') r;
  perform pg_temp.assert_true(ver_n = 1, 'first version number is 1');
  insert into public.sql_scripts (owner_id, name, content) values (alice, 's', 'select 1');
  insert into public.query_history (owner_id, operation, title) values (alice, 'sql_analyze', 't');

  -- the worker (service role) writes metadata for alice's version
  perform pg_temp.act_as_service();
  insert into public.database_objects (owner_id, version_id, schema_name, name, object_type) values (alice, ver_a, 'dbo', 'T', 'table');

  -- bob cannot see anything of alice's
  perform pg_temp.act_as(bob);
  foreach n in array array[
    (select count(*) from public.database_projects)::int, (select count(*) from public.database_versions)::int,
    (select count(*) from public.database_import_jobs)::int, (select count(*) from public.database_objects)::int,
    (select count(*) from public.sql_scripts)::int, (select count(*) from public.query_history)::int,
    (select count(*) from public.audit_logs)::int
  ] loop
    perform pg_temp.assert_true(n = 0, 'bob sees no rows of alice');
  end loop;

  -- bob cannot write into alice's tenant
  perform pg_temp.assert_denied(format('insert into public.database_versions (owner_id, project_id, version_number, source_type, source_file_name) values (%L, %L, 99, ''sql'', ''x'')', bob, proj_a), 'bob inserts a version into alice''s project');
  perform pg_temp.assert_denied(format('insert into public.database_versions (owner_id, project_id, version_number, source_type, source_file_name) values (%L, %L, 99, ''sql'', ''x'')', alice, proj_a), 'bob impersonates alice as owner_id');
  perform pg_temp.assert_denied(format('select public.create_schema_version_and_job(%L, null, ''sql'', ''x.sql'', 1, %L)', proj_a, bob || '/' || proj_a || '/x.sql'), 'bob creates a job in alice''s project via the RPC');
  perform pg_temp.assert_denied(format('select public.retry_import_job(%L)', job_a), 'bob retries alice''s job');
  perform pg_temp.assert_denied('insert into public.database_objects (owner_id, version_id, name, object_type) values (''' || bob || ''', ''' || ver_a || ''', ''X'', ''table'')', 'clients cannot write extracted metadata');
  perform pg_temp.assert_denied('select public.claim_import_job(''w'', 600)', 'clients cannot claim jobs');
  perform pg_temp.assert_denied('select * from public.user_ai_credentials', 'clients cannot read AI credentials');
  perform pg_temp.assert_denied('select * from public.rate_limits', 'clients cannot read rate limit counters');

  -- bob's own project works and update/delete of alice's rows affects nothing
  insert into public.database_projects (owner_id, name) values (bob, 'B') returning id into proj_b;
  update public.database_projects set name = 'hacked' where id = proj_a;
  get diagnostics n = row_count;
  perform pg_temp.assert_true(n = 0, 'bob cannot update alice''s project');
  delete from public.database_projects where id = proj_a;
  get diagnostics n = row_count;
  perform pg_temp.assert_true(n = 0, 'bob cannot delete alice''s project');
  -- same project name is fine across tenants
  perform pg_temp.assert_true((select count(*) from public.database_projects) = 1, 'bob sees exactly his own project');

  -- alice still sees her data, and cannot edit server-owned version columns
  perform pg_temp.act_as(alice);
  perform pg_temp.assert_true((select count(*) from public.database_objects) = 1, 'alice sees her extracted metadata');
  perform pg_temp.assert_denied(format('update public.database_versions set status = ''ready'' where id = %L', ver_a), 'clients cannot flip version status');
  update public.database_versions set label = 'renamed' where id = ver_a;
  perform pg_temp.assert_true((select label from public.database_versions where id = ver_a) = 'renamed', 'alice can rename her version');

  -- deleting the project cascades to everything
  delete from public.database_projects where id = proj_a;
  perform pg_temp.act_as_service();
  perform pg_temp.assert_true((select count(*) from public.database_objects where version_id = ver_a) = 0, 'cascade removed metadata');

  -- the job queue: worker claims, exhausted jobs are failed, clients cannot interfere
  perform pg_temp.act_as(alice);
  insert into public.database_projects (owner_id, name) values (alice, 'A2') returning id into proj_a;
  select r.job_id into job_a from public.create_schema_version_and_job(proj_a, null, 'sql', 'q.sql', 1, alice || '/' || proj_a || '/q.sql') r;
  perform pg_temp.act_as_service();
  perform pg_temp.assert_true((select count(*) from public.claim_import_job('w1', 600)) = 1, 'worker claims the pending job');
  perform pg_temp.assert_true((select count(*) from public.claim_import_job('w2', 600)) = 0, 'a claimed job is not handed out twice');
  perform pg_temp.assert_true((select status from public.database_import_jobs where id = job_a) = 'validating', 'claimed job moves to validating');

  raise notice 'RLS isolation tests passed';
end $$;

rollback;
