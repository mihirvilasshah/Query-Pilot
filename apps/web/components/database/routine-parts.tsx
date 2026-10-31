import { AlertTriangle, Database, GitBranch, Layers3, Repeat, ShieldCheck } from "lucide-react";
import type { ProcedureParameter } from "@querypilot/shared-types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import type { ObjectDetail } from "@/lib/data/queries";
import type { ObjectRow } from "@/lib/data/types";

export function ParametersTable({ parameters }: { parameters: ProcedureParameter[] }) {
  if (!parameters.length) return <p className="surface px-4 py-6 text-sm text-muted-foreground">No parameters.</p>;
  return (
    <div className="surface overflow-x-auto">
      <table className="w-full min-w-[480px] text-sm">
        <thead className="border-b text-left text-xs text-muted-foreground"><tr>{["Name", "Type", "Direction", "Default"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
        <tbody className="divide-y">
          {parameters.map((p) => (
            <tr key={p.name}>
              <td className="px-3 py-2 font-mono text-xs font-medium">{p.name}</td>
              <td className="px-3 py-2 font-mono text-xs">{p.dataType}</td>
              <td className="px-3 py-2"><Badge variant={p.direction === "in" ? "muted" : "info"}>{p.direction.toUpperCase()}</Badge></td>
              <td className="px-3 py-2 font-mono text-xs">{p.hasDefault ? p.defaultValue ?? "yes" : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RoutineFacts({ object, detail }: { object: ObjectRow; detail: ObjectDetail }) {
  const md = object.metadata as {
    hasTransaction?: boolean; hasDynamicSql?: boolean; dynamicSqlCount?: number; temporaryTables?: string[]; tableVariables?: string[];
    operations?: { select: number; insert: number; update: number; delete: number; merge: number }; returnType?: string | null; functionType?: string;
  };
  const ops = md.operations;
  const facts: { icon: typeof Database; label: string; value: React.ReactNode }[] = [
    { icon: Repeat, label: "Transaction statements", value: md.hasTransaction ? "Yes" : "No" },
    { icon: Layers3, label: "Temporary tables", value: md.temporaryTables?.length ? md.temporaryTables.join(", ") : "None" },
    { icon: Database, label: "Table variables", value: md.tableVariables?.length ? md.tableVariables.join(", ") : "None" },
    { icon: ShieldCheck, label: "Dynamic SQL", value: md.hasDynamicSql ? `Detected (${md.dynamicSqlCount ?? "≥1"})` : "Not detected" },
  ];
  if (md.returnType) facts.unshift({ icon: GitBranch, label: "Returns", value: <code className="font-mono text-xs">{md.returnType}</code> });
  if (md.functionType) facts.unshift({ icon: GitBranch, label: "Function type", value: md.functionType.replaceAll("_", " ") });
  return (
    <div className="space-y-4">
      {md.hasDynamicSql && (
        <Alert className="border-warning/40 bg-warning/10" data-testid="dynamic-warning">
          <AlertTriangle className="size-4 text-warning" />
          <AlertTitle>Dynamic SQL detected</AlertTitle>
          <AlertDescription>
            Objects referenced inside dynamic SQL strings cannot be resolved statically. The reference lists below are therefore <strong>not guaranteed to be complete</strong>; unresolved items are marked in the References tab.
          </AlertDescription>
        </Alert>
      )}
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {facts.map(({ icon: Icon, label, value }) => (
          <div key={label} className="surface flex items-start gap-3 p-3.5">
            <Icon className="mt-0.5 size-4 text-muted-foreground" />
            <div className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="break-words text-sm font-medium">{value}</dd></div>
          </div>
        ))}
      </dl>
      {ops && (
        <div className="surface p-4">
          <h3 className="mb-3 text-sm font-semibold">Statement operations</h3>
          <div className="flex flex-wrap gap-2">
            {(["select", "insert", "update", "delete", "merge"] as const).map((k) => (
              <Badge key={k} variant={ops[k] ? (k === "select" ? "info" : "danger") : "muted"} className="px-3 py-1 text-xs uppercase">{k} {ops[k]}</Badge>
            ))}
          </div>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{detail.outgoing.length} outgoing and {detail.incoming.length} incoming dependency links recorded.</p>
    </div>
  );
}
