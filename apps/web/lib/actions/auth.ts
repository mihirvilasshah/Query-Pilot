"use server";

import { redirect } from "next/navigation";
import { loginSchema, registerSchema, resetPasswordSchema, resetRequestSchema } from "@querypilot/shared-validation";
import { getAppUrl } from "@/lib/env";
import { fieldErrors, safeNext, type FormState } from "@/lib/redirect";
import { createClient } from "@/lib/supabase/server";

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: "Enter your email and password.", fieldErrors: fieldErrors(parsed.error.issues) };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    // Same message for wrong password and unknown user: no account enumeration.
    return { error: error.message.toLowerCase().includes("email not confirmed") ? "Confirm your email address first, then sign in." : "Invalid email or password." };
  }
  redirect(safeNext(String(formData.get("next") ?? "")));
}

export async function registerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = registerSchema.safeParse({
    displayName: formData.get("displayName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error.issues) };
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { display_name: parsed.data.displayName }, emailRedirectTo: `${getAppUrl()}/auth/callback?next=/dashboard` },
  });
  if (error) return { error: error.message };
  if (data.session) redirect("/dashboard");
  return { success: "Check your inbox to confirm your email address, then sign in." };
}

export async function requestPasswordResetAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = resetRequestSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { error: "Enter a valid email address.", fieldErrors: fieldErrors(parsed.error.issues) };
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, { redirectTo: `${getAppUrl()}/auth/callback?next=/reset-password` });
  return { success: "If an account exists for that email, a reset link is on its way." };
}

export async function updatePasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = resetPasswordSchema.safeParse({ password: formData.get("password") });
  if (!parsed.success) return { error: "Choose a stronger password.", fieldErrors: fieldErrors(parsed.error.issues) };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: "Could not update the password. Your reset link may have expired." };
  return { success: "Password updated." };
}

export async function logoutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
