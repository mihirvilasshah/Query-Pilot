"use client";

import { ChevronDown, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/common/logo";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { NAV, isActive, type NavItem } from "./nav";

function NavLink({ item, collapsed, nested, onNavigate }: { item: NavItem; collapsed: boolean; nested?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = isActive(pathname, item.href, nested && item.href === "/database-intelligence");
  const Icon = item.icon;
  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        active && "bg-sidebar-accent text-sidebar-accent-foreground",
        collapsed && "justify-center px-0 py-2",
        nested && !collapsed && "py-1.5 pl-2 text-[12.5px]",
      )}
    >
      <Icon className={cn("size-4 shrink-0", active ? "text-primary" : "text-muted-foreground group-hover:text-current")} />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  );
  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}

function NavGroup({ item, collapsed, onNavigate }: { item: NavItem; collapsed: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const inGroup = isActive(pathname, item.href);
  const [openState, setOpen] = useState<boolean | null>(null);
  const open = openState ?? inGroup;

  if (collapsed) return <NavLink item={item} collapsed onNavigate={onNavigate} />;
  const Icon = item.icon;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          inGroup && "text-sidebar-accent-foreground",
        )}
      >
        <Icon className={cn("size-4 shrink-0", inGroup ? "text-primary" : "text-muted-foreground")} />
        <span className="flex-1 truncate text-left">{item.label}</span>
        <ChevronDown className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="ml-[17px] mt-0.5 space-y-0.5 border-l pl-2">
          {item.children?.map((c) => <NavLink key={c.href} item={c} collapsed={false} nested onNavigate={onNavigate} />)}
        </div>
      )}
    </div>
  );
}

export function SidebarContent({ collapsed, onNavigate, onToggle }: { collapsed: boolean; onNavigate?: () => void; onToggle?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className={cn("flex h-14 items-center border-b px-3", collapsed ? "justify-center" : "justify-between")}>
        <Link href="/dashboard" onClick={onNavigate} aria-label="QueryPilot home">
          <Logo showText={!collapsed} />
        </Link>
      </div>
      <nav aria-label="Main" className="scroll-thin flex-1 space-y-0.5 overflow-y-auto p-2">
        {NAV.map((item) =>
          item.children ? <NavGroup key={item.href} item={item} collapsed={collapsed} onNavigate={onNavigate} /> : <NavLink key={item.href} item={item} collapsed={collapsed} onNavigate={onNavigate} />,
        )}
      </nav>
      {onToggle && (
        <div className="border-t p-2">
          <Button variant="ghost" size={collapsed ? "icon" : "sm"} onClick={onToggle} className="w-full justify-start text-muted-foreground" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            {collapsed ? <PanelLeftOpen className="size-4" /> : <><PanelLeftClose className="size-4" /> Collapse</>}
          </Button>
        </div>
      )}
    </div>
  );
}
