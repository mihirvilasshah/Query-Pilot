"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginAction, registerAction, requestPasswordResetAction, updatePasswordAction } from "@/lib/actions/auth";
import type { FormState } from "@/lib/redirect";

function Submit({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending && <Loader2 className="size-4 animate-spin" />}
      {children}
    </Button>
  );
}

function Field({ id, label, type = "text", state, autoComplete, hint, placeholder, defaultValue }: { id: string; label: string; type?: string; state: FormState; autoComplete?: string; hint?: string; placeholder?: string; defaultValue?: string }) {
  const err = state.fieldErrors?.[id];
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={id} type={type} autoComplete={autoComplete} placeholder={placeholder} defaultValue={defaultValue} aria-invalid={!!err} required />
      {err ? <p className="text-xs text-destructive">{err}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Feedback({ state }: { state: FormState }) {
  if (state.error)
    return (
      <Alert variant="destructive" role="alert">
        <AlertCircle className="size-4" />
        <AlertDescription>{state.error}</AlertDescription>
      </Alert>
    );
  if (state.success)
    return (
      <Alert role="status">
        <CheckCircle2 className="size-4" />
        <AlertDescription>{state.success}</AlertDescription>
      </Alert>
    );
  return null;
}

export function LoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState(loginAction, {} as FormState);
  return (
    <form action={action} className="space-y-4" data-testid="login-form">
      <input type="hidden" name="next" value={next ?? ""} />
      <Feedback state={state} />
      <Field id="email" label="Email" type="email" autoComplete="email" state={state} placeholder="you@company.com" />
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Password</Label>
          <Link href="/forgot-password" className="text-xs text-muted-foreground hover:text-foreground">
            Forgot password?
          </Link>
        </div>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <Submit>Sign in</Submit>
      <p className="text-center text-sm text-muted-foreground">
        New to QueryPilot?{" "}
        <Link href="/register" className="font-medium text-foreground hover:underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}

export function RegisterForm() {
  const [state, action] = useActionState(registerAction, {} as FormState);
  return (
    <form action={action} className="space-y-4" data-testid="register-form">
      <Feedback state={state} />
      <Field id="displayName" label="Name" autoComplete="name" state={state} placeholder="Ada Lovelace" />
      <Field id="email" label="Email" type="email" autoComplete="email" state={state} placeholder="you@company.com" />
      <Field id="password" label="Password" type="password" autoComplete="new-password" state={state} hint="At least 10 characters with upper case, lower case and a number." />
      <Submit>Create account</Submit>
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-foreground hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action] = useActionState(requestPasswordResetAction, {} as FormState);
  return (
    <form action={action} className="space-y-4">
      <Feedback state={state} />
      <Field id="email" label="Email" type="email" autoComplete="email" state={state} />
      <Submit>Send reset link</Submit>
      <p className="text-center text-sm">
        <Link href="/login" className="text-muted-foreground hover:text-foreground">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}

export function ResetPasswordForm() {
  const [state, action] = useActionState(updatePasswordAction, {} as FormState);
  return (
    <form action={action} className="space-y-4">
      <Feedback state={state} />
      <Field id="password" label="New password" type="password" autoComplete="new-password" state={state} hint="At least 10 characters with upper case, lower case and a number." />
      <Submit>Update password</Submit>
      {state.success && (
        <p className="text-center text-sm">
          <Link href="/dashboard" className="font-medium hover:underline">
            Continue to QueryPilot
          </Link>
        </p>
      )}
    </form>
  );
}
