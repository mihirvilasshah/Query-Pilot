-- QueryPilot Release 1 core schema.
-- Conventions: UUID primary keys, created_at/updated_at on every table, text + CHECK
-- instead of PG enums so values can evolve without painful ALTER TYPE migrations.
-- Every row carries owner_id so Row Level Security stays a cheap equality check.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm with schema extensions;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles / preferences
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  theme text not null default 'system' check (theme in ('light', 'dark', 'system')),
  sidebar_collapsed boolean not null default false,
  default_dialect text not null default 'tsql' check (default_dialect in ('tsql', 'postgresql', 'mysql', 'sqlite')),
  ai_provider text check (ai_provider in ('gemini', 'openrouter')),
  ai_model text,
  ai_external_consent boolean not null default false,
  ai_external_consent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Encrypted per-user provider credentials (AES-256-GCM, encrypted server-side by the web app).
-- The ciphertext is never returned to the browser by any application route.
create table public.user_ai_credentials (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('gemini', 'openrouter')),
  ciphertext text not null,
  iv text not null,
  auth_tag text not null,
  key_version int not null default 1,
  key_hint text,
  validated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, provider)
);

-- ---------------------------------------------------------------------------
-- projects & schema versions
-- ---------------------------------------------------------------------------
create table public.database_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text check (description is null or char_length(description) <= 2000),
  platform text not null default 'sqlserver'
    check (platform in ('sqlserver', 'azure_sql_database', 'azure_sql_managed_instance', 'postgresql', 'mysql', 'sqlite', 'other')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, name)
);
create index database_projects_owner_idx on public.database_projects (owner_id, updated_at desc);

create table public.database_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.database_projects (id) on delete cascade,
  version_number int not null check (version_number > 0),
  label text,
  source_type text not null check (source_type in ('dacpac', 'sql')),
  source_file_name text not null,
  storage_path text,
  source_sha256 text,
  database_name text,
  status text not null default 'pending' check (status in ('pending', 'ready', 'ready_with_warnings', 'failed')),
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, version_number)
);
create index database_versions_project_idx on public.database_versions (project_id, version_number desc);
create index database_versions_owner_idx on public.database_versions (owner_id);

-- ---------------------------------------------------------------------------
-- import jobs (PostgreSQL-backed queue)
-- ---------------------------------------------------------------------------
create table public.database_import_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.database_projects (id) on delete cascade,
  version_id uuid not null references public.database_versions (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'validating', 'processing', 'completed', 'completed_with_warnings', 'failed')),
  stage text,
  progress int not null default 0 check (progress between 0 and 100),
  file_name text not null,
  file_size bigint not null check (file_size >= 0),
  file_type text not null check (file_type in ('dacpac', 'sql')),
  storage_path text not null,
  source_sha256 text,
  error_code text,
  error_message text,
  warnings jsonb not null default '[]'::jsonb,
  attempts int not null default 0,
  max_attempts int not null default 3,
  locked_at timestamptz,
  locked_by text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index database_import_jobs_queue_idx on public.database_import_jobs (status, created_at)
  where status in ('pending', 'validating', 'processing');
create index database_import_jobs_project_idx on public.database_import_jobs (project_id, created_at desc);
create unique index database_import_jobs_version_uidx on public.database_import_jobs (version_id);

-- ---------------------------------------------------------------------------
-- extracted metadata (written by the processing worker only)
-- ---------------------------------------------------------------------------
create table public.database_objects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  version_id uuid not null references public.database_versions (id) on delete cascade,
  schema_name text not null default '',
  name text not null,
  object_type text not null
    check (object_type in ('schema', 'table', 'view', 'procedure', 'function', 'trigger', 'sequence', 'type', 'synonym', 'other')),
  parent_object_id uuid references public.database_objects (id) on delete set null,
  definition text,
  metadata jsonb not null default '{}'::jsonb,
  source_file text,
  source_line int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (version_id, object_type, schema_name, name)
);
create index database_objects_version_type_idx on public.database_objects (version_id, object_type);
create index database_objects_name_trgm_idx on public.database_objects using gin (name extensions.gin_trgm_ops);
create index database_objects_owner_idx on public.database_objects (owner_id);

create table public.database_columns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  version_id uuid not null references public.database_versions (id) on delete cascade,
  object_id uuid not null references public.database_objects (id) on delete cascade,
  name text not null,
  ordinal int not null,
  data_type text not null,
  max_length int,
  numeric_precision int,
  numeric_scale int,
  is_nullable boolean,
  default_value text,
  is_identity boolean not null default false,
  is_primary_key boolean not null default false,
  is_computed boolean not null default false,
  computed_expression text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (object_id, name)
);
create index database_columns_object_idx on public.database_columns (object_id, ordinal);
create index database_columns_version_idx on public.database_columns (version_id);

create table public.database_relationships (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  version_id uuid not null references public.database_versions (id) on delete cascade,
  name text,
  kind text not null default 'declared' check (kind in ('declared', 'inferred')),
  source_object_id uuid not null references public.database_objects (id) on delete cascade,
  target_object_id uuid references public.database_objects (id) on delete cascade,
  target_schema text,
  target_name text,
  source_columns text[] not null default '{}',
  target_columns text[] not null default '{}',
  on_delete text,
  on_update text,
  origin text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index database_relationships_version_idx on public.database_relationships (version_id);
create index database_relationships_source_idx on public.database_relationships (source_object_id);
create index database_relationships_target_idx on public.database_relationships (target_object_id);

create table public.database_indexes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  version_id uuid not null references public.database_versions (id) on delete cascade,
  object_id uuid not null references public.database_objects (id) on delete cascade,
  name text not null,
  index_type text,
  is_unique boolean not null default false,
  is_primary_key boolean not null default false,
  is_unique_constraint boolean not null default false,
  key_columns jsonb not null default '[]'::jsonb,
  included_columns text[] not null default '{}',
  filter_definition text,
  definition text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index database_indexes_object_idx on public.database_indexes (object_id);
create index database_indexes_version_idx on public.database_indexes (version_id);

-- CHECK / DEFAULT / PRIMARY KEY / UNIQUE constraints (foreign keys live in database_relationships).
create table public.database_constraints (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  version_id uuid not null references public.database_versions (id) on delete cascade,
  object_id uuid not null references public.database_objects (id) on delete cascade,
  name text,
  constraint_type text not null check (constraint_type in ('primary_key', 'unique', 'check', 'default')),
  columns text[] not null default '{}',
  expression text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index database_constraints_object_idx on public.database_constraints (object_id);
create index database_constraints_version_idx on public.database_constraints (version_id);

create table public.database_dependencies (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  version_id uuid not null references public.database_versions (id) on delete cascade,
  source_object_id uuid not null references public.database_objects (id) on delete cascade,
  target_object_id uuid references public.database_objects (id) on delete cascade,
  target_schema text,
  target_name text,
  target_type text,
  kind text not null check (kind in ('reads', 'writes', 'executes', 'calls_function', 'references', 'trigger_on')),
  operations text[] not null default '{}',
  confidence text not null
    check (confidence in ('confirmed_static', 'parsed_reference', 'inferred', 'unresolved_dynamic')),
  origin text not null,
  line int,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index database_dependencies_version_idx on public.database_dependencies (version_id);
create index database_dependencies_source_idx on public.database_dependencies (source_object_id);
create index database_dependencies_target_idx on public.database_dependencies (target_object_id);

-- ---------------------------------------------------------------------------
-- comparisons, migrations
-- ---------------------------------------------------------------------------
create table public.schema_comparisons (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.database_projects (id) on delete cascade,
  base_version_id uuid not null references public.database_versions (id) on delete cascade,
  target_version_id uuid not null references public.database_versions (id) on delete cascade,
  summary jsonb not null default '{}'::jsonb,
  diff jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (base_version_id <> target_version_id)
);
create index schema_comparisons_project_idx on public.schema_comparisons (project_id, created_at desc);

create table public.migration_plans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.database_projects (id) on delete cascade,
  comparison_id uuid references public.schema_comparisons (id) on delete set null,
  source_version_id uuid not null references public.database_versions (id) on delete cascade,
  target_version_id uuid not null references public.database_versions (id) on delete cascade,
  title text not null,
  plan jsonb not null default '{}'::jsonb,
  migration_sql text not null default '',
  rollback_sql text not null default '',
  status text not null default 'draft' check (status in ('draft', 'reviewed', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index migration_plans_project_idx on public.migration_plans (project_id, created_at desc);

-- ---------------------------------------------------------------------------
-- SQL scripts
-- ---------------------------------------------------------------------------
create table public.sql_scripts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid references public.database_projects (id) on delete set null,
  name text not null check (char_length(name) between 1 and 200),
  description text,
  content text not null default '',
  dialect text not null default 'tsql' check (dialect in ('tsql', 'postgresql', 'mysql', 'sqlite')),
  tags text[] not null default '{}',
  category text,
  is_favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sql_scripts_owner_idx on public.sql_scripts (owner_id, updated_at desc);
create index sql_scripts_project_idx on public.sql_scripts (project_id);

create table public.sql_script_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  script_id uuid not null references public.sql_scripts (id) on delete cascade,
  version_number int not null,
  name text not null,
  content text not null,
  change_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (script_id, version_number)
);

create table public.sql_analyses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid references public.database_projects (id) on delete set null,
  script_id uuid references public.sql_scripts (id) on delete set null,
  dialect text not null default 'tsql',
  input_sql text not null,
  overall_risk text not null check (overall_risk in ('critical', 'high', 'medium', 'low', 'informational')),
  result jsonb not null default '{}'::jsonb,
  ai_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sql_analyses_owner_idx on public.sql_analyses (owner_id, created_at desc);

-- ---------------------------------------------------------------------------
-- AI
-- ---------------------------------------------------------------------------
create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid references public.database_projects (id) on delete cascade,
  version_id uuid references public.database_versions (id) on delete set null,
  title text not null default 'New conversation',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ai_conversations_owner_idx on public.ai_conversations (owner_id, updated_at desc);

create table public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid not null references public.ai_conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  structured jsonb,
  object_refs jsonb not null default '[]'::jsonb,
  provider text,
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ai_messages_conversation_idx on public.ai_messages (conversation_id, created_at);

-- One row per outbound AI call: powers "requests used" and request history. Never stores prompts or keys.
create table public.ai_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  provider text not null,
  model text not null,
  operation text not null,
  status text not null check (status in ('success', 'error', 'rate_limited', 'timeout')),
  latency_ms int,
  error_code text,
  input_tokens int,
  output_tokens int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ai_requests_owner_idx on public.ai_requests (owner_id, created_at desc);

create table public.query_history (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid references public.database_projects (id) on delete set null,
  operation text not null
    check (operation in ('sql_explain', 'sql_generate', 'sql_analyze', 'sql_optimize', 'schema_comparison', 'ai_conversation', 'migration_plan', 'documentation')),
  title text not null,
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  ref_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index query_history_owner_idx on public.query_history (owner_id, created_at desc);
create index query_history_operation_idx on public.query_history (owner_id, operation);

-- ---------------------------------------------------------------------------
-- audit + rate limiting
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users (id) on delete set null,
  action text not null,
  entity_type text,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index audit_logs_owner_idx on public.audit_logs (owner_id, created_at desc);

create table public.rate_limits (
  bucket_key text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (bucket_key, window_start)
);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'user_preferences', 'user_ai_credentials', 'database_projects', 'database_versions',
    'database_import_jobs', 'database_objects', 'database_columns', 'database_relationships',
    'database_indexes', 'database_constraints', 'database_dependencies', 'schema_comparisons',
    'migration_plans', 'sql_scripts', 'sql_script_versions', 'sql_analyses', 'ai_conversations',
    'ai_messages', 'ai_requests', 'query_history', 'audit_logs'
  ]
  loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      t || '_set_updated_at', t
    );
  end loop;
end $$;

-- Bump the project's updated_at whenever a version is added so "recent projects" stays accurate.
create or replace function public.touch_project()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.database_projects set updated_at = now() where id = new.project_id;
  return new;
end;
$$;
create trigger database_versions_touch_project after insert or update on public.database_versions
  for each row execute function public.touch_project();

-- Auto-provision profile + preferences on signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  insert into public.user_preferences (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
