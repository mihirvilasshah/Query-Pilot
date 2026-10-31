"use client";

import { Menu, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { GlobalSearch } from "./global-search";
import { Notifications, type NotificationJob } from "./notifications";
import { ProjectSelector, type ProjectOption } from "./project-selector";
import { SidebarContent } from "./sidebar";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";

export interface ShellProps {
  user: { email: string; displayName: string };
  projects: ProjectOption[];
  currentProjectId: string | null;
  jobs: NotificationJob[];
  children: React.ReactNode;
}

const STORAGE_KEY = "qp-sidebar-collapsed";

export function AppShell({ user, projects, currentProjectId, jobs, children }: ShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restore persisted preference after hydration
    setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
  }, []);

  const toggle = () => {
    setCollapsed((c) => {
      localStorage.setItem(STORAGE_KEY, c ? "0" : "1");
      return !c;
    });
  };

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className={cn("hidden shrink-0 border-r bg-sidebar transition-[width] duration-200 md:block", collapsed ? "w-[60px]" : "w-64")} data-testid="sidebar" data-collapsed={collapsed}>
        <SidebarContent collapsed={collapsed} onToggle={toggle} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur sm:px-4">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 bg-sidebar p-0">
              <SheetHeader className="sr-only">
                <SheetTitle>Navigation</SheetTitle>
                <SheetDescription>Main navigation</SheetDescription>
              </SheetHeader>
              <SidebarContent collapsed={false} onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>

          <ProjectSelector projects={projects} currentId={currentProjectId} />
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <GlobalSearch />
            <Button asChild variant="ghost" size="sm" className="hidden gap-1.5 sm:inline-flex">
              <Link href="/database-intelligence/assistant">
                <Sparkles className="size-4 text-primary" /> Ask AI
              </Link>
            </Button>
            <Button asChild variant="ghost" size="icon" className="sm:hidden" aria-label="Ask AI">
              <Link href="/database-intelligence/assistant">
                <Sparkles className="size-4 text-primary" />
              </Link>
            </Button>
            <ThemeToggle />
            <Notifications jobs={jobs} />
            <UserMenu email={user.email} displayName={user.displayName} />
          </div>
        </header>
        <main id="main" className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1400px] p-4 sm:p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
