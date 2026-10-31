import { AlertCircle, KeyRound, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { ApiFailure } from "@/lib/ai/client";

/** Renders an AI failure with an actionable hint. AI is optional: nothing else in the app is affected. */
export function AiErrorNotice({ error }: { error: ApiFailure }) {
  const needsSetup = error.code === "ai_not_configured" || error.code === "ai_invalid_api_key";
  const needsConsent = error.code === "ai_consent_required";
  const Icon = needsConsent ? ShieldAlert : needsSetup ? KeyRound : AlertCircle;
  return (
    <Alert variant={needsSetup || needsConsent ? "default" : "destructive"} role="alert" data-testid="ai-error">
      <Icon className="size-4" />
      <AlertTitle>{needsConsent ? "Consent needed" : needsSetup ? "AI is not set up" : "AI request failed"}</AlertTitle>
      <AlertDescription>
        {error.message}
        {(needsSetup || needsConsent) && (
          <> <Link href="/settings?tab=ai" className="font-medium underline">Open AI settings</Link></>
        )}
      </AlertDescription>
    </Alert>
  );
}

export function ExternalAiNotice() {
  return (
    <p className="flex items-start gap-2 text-xs text-muted-foreground">
      <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
      AI features send the SQL and metadata shown to you to the configured external provider, which processes it under its own data policy. Only retrieved, relevant metadata is sent - never whole databases or credentials.
    </p>
  );
}
