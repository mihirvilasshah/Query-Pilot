import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader, SectionCard } from "@/components/common/page";
import { AiSettingsPanel, type AiRequestRow } from "@/components/settings/ai-settings-panel";
import { PreferencesForm, ProfileForm } from "@/components/settings/profile-forms";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getPreferences, resolveAiConfig } from "@/lib/ai/config";
import { requireUser } from "@/lib/auth";
import { isEncryptionConfigured } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const supabase = await createClient();
  const ctx = { supabase, user };
  const [{ config }, prefs, profile, reqs] = await Promise.all([
    resolveAiConfig(ctx),
    getPreferences(ctx),
    supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
    supabase.from("ai_requests").select("id,provider,model,operation,status,latency_ms,error_code,created_at").order("created_at", { ascending: false }).limit(15),
  ]);
  const tab = ["profile", "ai", "preferences", "security"].includes(sp.tab ?? "") ? sp.tab! : "profile";
  return (
    <>
      <PageHeader title="Settings" description="Profile, AI provider, preferences and security." />
      <Tabs defaultValue={tab}>
        <TabsList className="mb-5">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="ai">AI</TabsTrigger>
          <TabsTrigger value="preferences">Preferences</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
        </TabsList>
        <TabsContent value="profile"><SectionCard title="Profile"><ProfileForm displayName={(profile.data?.display_name as string) ?? ""} email={user.email ?? ""} /></SectionCard></TabsContent>
        <TabsContent value="ai"><AiSettingsPanel initial={config} encryptionAvailable={isEncryptionConfigured() && createAdminClient() !== null} requests={(reqs.data ?? []) as AiRequestRow[]} /></TabsContent>
        <TabsContent value="preferences"><SectionCard title="Preferences"><PreferencesForm defaultDialect={prefs.default_dialect} /></SectionCard></TabsContent>
        <TabsContent value="security">
          <SectionCard title="Security & privacy">
            <ul className="space-y-3 text-sm">
              {[
                "Your projects, schema versions, scripts and history are isolated by Row Level Security: other users cannot read them.",
                "Uploaded files are stored in a private bucket under your own folder and are parsed by a separate worker - uploaded SQL is never executed.",
                "QueryPilot never connects to your databases and never executes generated SQL or migration scripts.",
                "AI provider keys are used server-side only and never reach the browser. Saved keys are encrypted at rest.",
                "Deleting a project permanently deletes its uploaded files and all extracted metadata.",
              ].map((t) => <li key={t} className="flex gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />{t}</li>)}
            </ul>
          </SectionCard>
        </TabsContent>
      </Tabs>
    </>
  );
}
