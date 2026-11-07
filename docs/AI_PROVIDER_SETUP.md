# AI provider setup

AI is **optional**. With no provider configured every deterministic feature (import, explorers, graphs, analyzer, comparison, migrations, documentation) still works; AI buttons show a clear "AI is not set up" notice.

## Choose a provider

| Provider | Free option | Get a key |
|---|---|---|
| Google Gemini | Google AI Studio free tier (rate limited) | https://aistudio.google.com/apikey |
| OpenRouter | Models whose id ends in `:free` | https://openrouter.ai/keys |
| Groq | Free tier (rate limited), e.g. `openai/gpt-oss-120b` | https://console.groq.com/keys |

Free-tier availability, model names and limits change often. QueryPilot therefore **does not hardcode models**: defaults come from environment variables and the Settings page lists the live models from the provider (OpenRouter: free only). `SUGGESTED_MODELS` in `ai-core` is only a starting point.

## Option A - server environment variables (single user / simplest)

Set in `apps/web/.env.local` (or Vercel project settings):

```
AI_DEFAULT_PROVIDER=gemini            # or openrouter | groq
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-2.5-flash
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=openrouter/free
GROQ_API_KEY=...
GROQ_MODEL=openai/gpt-oss-120b
AI_ALLOW_PAID_MODELS=false
```

Keys live only on the server. Users must still tick the **consent** box in *Settings → AI* before anything is sent.

## Option B - per-user encrypted keys (multi-user)

Set `SUPABASE_SERVICE_ROLE_KEY` and `CREDENTIAL_ENCRYPTION_KEY` (32 random bytes, base64):

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Users then paste their own key in *Settings → AI*. The key is validated against the provider, encrypted with AES-256-GCM (fresh IV per key) and stored in `user_ai_credentials`, a table that **no client can read** (RLS enabled, no policies, grants revoked). It is decrypted server-side per request and never returned to the browser. Rotate `CREDENTIAL_ENCRYPTION_KEY` by re-saving keys (a `key_version` column exists for a future re-encryption job); use a secret manager (Vercel encrypted env, Azure Key Vault, AWS Secrets Manager) to hold it in production.

## Behaviour guarantees

* **No silent paid fallback.** OpenRouter models must end in `:free` (or be `openrouter/free`) unless `AI_ALLOW_PAID_MODELS=true`; HTTP 402 is reported as a paid-model block, never retried on another model. Gemini free-tier eligibility depends on your Google project; Groq free-tier eligibility depends on your Groq account.
* **Errors are normalised** (`AiError`): invalid key, rate limit, timeout, model unavailable, blocked content, bad response, network. Rate limits / 5xx / timeouts are retried with exponential backoff + jitter and `Retry-After`; invalid keys are never retried.
* **Structured output** is validated with Zod; one automatic repair attempt, then a clear error.
* **Usage**: only what providers report is shown (e.g. OpenRouter key usage/limit). Gemini free-tier quota is not queryable, so none is shown. `ai_requests` stores provider/model/status/latency only - never prompts or responses.
* **Privacy warning**: SQL and retrieved metadata are sent to the external provider under its data policy; consent is explicit and revocable. Credentials and row data are never sent.

## Adding a provider

Implement `complete()`, `validateApiKey()` and `listModels()` by extending `BaseAiProvider` (see `packages/ai-core/src/providers/*.ts`), register it in `factory.ts` and add it to `AiProviderId` and the `ai_provider` CHECK constraint. All prompts, structured output and verification are inherited.
