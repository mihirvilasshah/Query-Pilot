import type { AiProviderId } from "@querypilot/shared-types";
import { AiError } from "./errors";
import { defaultHttpOptions, type HttpOptions } from "./http";
import { GeminiProvider } from "./providers/gemini";
import { GroqProvider } from "./providers/groq";
import { OpenRouterProvider } from "./providers/openrouter";
import type { AiProvider } from "./types";

export interface CreateProviderConfig {
  provider: AiProviderId;
  apiKey: string | undefined | null;
  model: string | undefined | null;
  /** Never silently switch to paid models; OpenRouter models must end in ":free" unless this is true. */
  allowPaidModels?: boolean;
  appName?: string;
  appUrl?: string;
  http?: Partial<HttpOptions>;
}

export function createAiProvider(config: CreateProviderConfig): AiProvider {
  if (!config.apiKey) throw new AiError("not_configured", "No API key is configured for the selected AI provider.");
  if (!config.model) throw new AiError("not_configured", "No model is selected for the AI provider.");
  const http = defaultHttpOptions(config.http);
  switch (config.provider) {
    case "gemini":
      return new GeminiProvider({ apiKey: config.apiKey, model: config.model, http });
    case "openrouter":
      return new OpenRouterProvider({
        apiKey: config.apiKey,
        model: config.model,
        http,
        ...(config.allowPaidModels !== undefined ? { allowPaidModels: config.allowPaidModels } : {}),
        ...(config.appName ? { appName: config.appName } : {}),
        ...(config.appUrl ? { appUrl: config.appUrl } : {}),
      });
    case "groq":
      return new GroqProvider({ apiKey: config.apiKey, model: config.model, http });
    default:
      throw new AiError("not_configured", `Unsupported AI provider: ${String(config.provider)}`);
  }
}
