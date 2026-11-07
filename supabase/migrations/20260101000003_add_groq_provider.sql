-- Add Groq as an AI provider option.
-- The original inline CHECK constraints were created in 20260101000001_core_schema.sql.
alter table public.user_preferences drop constraint if exists user_preferences_ai_provider_check;
alter table public.user_preferences
  add constraint user_preferences_ai_provider_check
  check (ai_provider in ('gemini', 'openrouter', 'groq'));

alter table public.user_ai_credentials drop constraint if exists user_ai_credentials_provider_check;
alter table public.user_ai_credentials
  add constraint user_ai_credentials_provider_check
  check (provider in ('gemini', 'openrouter', 'groq'));
