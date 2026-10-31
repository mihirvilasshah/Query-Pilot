import {
  Activity, Boxes, Braces, Database, FileCode2, FolderGit2, GitCompareArrows, History, LayoutDashboard, ListTree, Network, PlugZap,
  Settings, Sparkles, SquareFunction, Table2, Workflow, Zap, FileSearch, Layers, type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  children?: NavItem[];
}

export const NAV: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  {
    label: "Database Intelligence",
    href: "/database-intelligence",
    icon: Database,
    children: [
      { label: "Database Overview", href: "/database-intelligence", icon: Boxes },
      { label: "Table Explorer", href: "/database-intelligence/tables", icon: Table2 },
      { label: "View Explorer", href: "/database-intelligence/views", icon: Layers },
      { label: "Stored Procedures", href: "/database-intelligence/procedures", icon: Workflow },
      { label: "Function Explorer", href: "/database-intelligence/functions", icon: SquareFunction },
      { label: "Triggers", href: "/database-intelligence/triggers", icon: Zap },
      { label: "Indexes & Constraints", href: "/database-intelligence/indexes", icon: ListTree },
      { label: "Dependency Explorer", href: "/database-intelligence/dependencies", icon: Network },
      { label: "ER Diagrams", href: "/database-intelligence/er-diagram", icon: Braces },
      { label: "Database AI Assistant", href: "/database-intelligence/assistant", icon: Sparkles },
      { label: "Schema Versions", href: "/database-intelligence/versions", icon: Activity },
      { label: "Import Schema", href: "/database-intelligence/import", icon: PlugZap },
    ],
  },
  { label: "SQL Workspace", href: "/sql-workspace", icon: FileCode2 },
  { label: "AI SQL Assistant", href: "/ai-assistant", icon: Sparkles },
  { label: "SQL Script Analyzer", href: "/sql-analyzer", icon: FileSearch },
  { label: "Schema Comparison", href: "/schema-comparison", icon: GitCompareArrows },
  { label: "Migration Assistant", href: "/migration-assistant", icon: Workflow },
  { label: "Query History", href: "/history", icon: History },
  { label: "Saved Projects", href: "/projects", icon: FolderGit2 },
  { label: "Settings", href: "/settings", icon: Settings },
];

export function isActive(pathname: string, href: string, exact = false): boolean {
  if (exact || href === "/dashboard") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
