import Link from "next/link";
import { KeyRound, Link2 } from "lucide-react";
import { DEPENDENCY_CONFIDENCE_LABELS, type DependencyConfidence } from "@querypilot/shared-types";
import { Badge } from "@/components/ui/badge";
import { formatColumnType } from "@/lib/format";
import type { ColumnRow, DependencyRow, IndexRow, ConstraintRow, RelationshipRow } from "@/lib/data/types";
import type { ObjectDetail } from "@/lib/data/queries";
import { objectHref } from "@/lib/object-links";

const CONF_VARIANT: Record<DependencyConfidence, "success" | "info" | "warning" | "danger"> = {
  confirmed_static: "success",
  parsed_reference: "info",
  inferred: "warning",
  unresolved_dynamic: "danger",
};

export function ConfidenceBadge({ confidence }: { confidence: DependencyConfidence }) {
  return <Badge variant={CONF_VARIANT[confidence]} title={DEPENDENCY_CONFIDENCE_LABELS[confidence]}>{DEPENDENCY_CONFIDENCE_LABELS[confidence]}</Badge>;
}

export function ObjectLink({ type, id, schema, name }: { type: string; id: string; schema: string; name: string }) {
  return (
    <Link href={objectHref(type, id, name)} className="font-medium text-primary hover:underline">
      {schema ? `${schema}.` : ""}{name}
    </Link>
  );
}

export function ColumnsTable({ columns, fkColumns }: { columns: ColumnRow[]; fkColumns: Set<string> }) {
  if (columns.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">No column metadata was captured for this object.</p>;
  const dash = <span className="text-muted-foreground">—</span>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm" data-testid="columns-table">
        <thead className="border-b text-left text-xs text-muted-foreground">
          <tr>
            {["#", "Column", "Type", "Length", "Precision", "Scale", "Nullable", "Default", "Identity", "Keys"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y">
          {columns.map((c) => (
            <tr key={c.id} className="hover:bg-muted/40">
              <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums">{c.ordinal}</td>
              <td className="px-3 py-2 font-medium">{c.name}</td>
              <td className="px-3 py-2 font-mono text-xs">{formatColumnType(c)}{c.is_computed && <Badge variant="muted" className="ml-1.5">computed</Badge>}</td>
              <td className="px-3 py-2 tabular-nums">{c.max_length == null ? dash : c.max_length === -1 ? "max" : c.max_length}</td>
              <td className="px-3 py-2 tabular-nums">{c.numeric_precision ?? dash}</td>
              <td className="px-3 py-2 tabular-nums">{c.numeric_scale ?? dash}</td>
              <td className="px-3 py-2">{c.is_nullable == null ? <span className="text-muted-foreground" title="Unknown">?</span> : c.is_nullable ? "yes" : <span className="font-medium">no</span>}</td>
              <td className="px-3 py-2 font-mono text-xs">{c.default_value ?? c.computed_expression ?? dash}</td>
              <td className="px-3 py-2">{c.is_identity ? "yes" : dash}</td>
              <td className="px-3 py-2">
                <span className="flex gap-1">
                  {c.is_primary_key && <Badge variant="default"><KeyRound /> PK</Badge>}
                  {fkColumns.has(c.name.toLowerCase()) && <Badge variant="secondary"><Link2 /> FK</Badge>}
                  {!c.is_primary_key && !fkColumns.has(c.name.toLowerCase()) && dash}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type NameMap = ObjectDetail["nameById"];

export function RelationshipsList({ outgoing, incoming, names, selfId }: { outgoing: RelationshipRow[]; incoming: RelationshipRow[]; names: NameMap; selfId: string }) {
  const nm = (id: string | null, schema: string | null, name: string | null) => {
    const hit = id ? names[id] : undefined;
    if (hit && id) return <ObjectLink type={hit.type} id={id} schema={hit.schema} name={hit.name} />;
    return <span className="text-muted-foreground">{[schema, name].filter(Boolean).join(".") || "unknown"} <em>(not in this import)</em></span>;
  };
  const kindBadge = (k: string) => (k === "declared" ? <Badge variant="success">Declared FK</Badge> : <Badge variant="warning" title="Inferred from naming; not a real constraint">Inferred</Badge>);
  const Row = ({ r, dir }: { r: RelationshipRow; dir: "out" | "in" }) => (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
      {kindBadge(r.kind)}
      <span className="font-mono text-xs text-muted-foreground">{r.name ?? "(unnamed)"}</span>
      {dir === "out" ? (
        <span>({r.source_columns.join(", ")}) → {nm(r.target_object_id, r.target_schema, r.target_name)} ({r.target_columns.join(", ")})</span>
      ) : (
        <span>{nm(r.source_object_id, null, null)} ({r.source_columns.join(", ")}) → ({r.target_columns.join(", ")})</span>
      )}
      {r.on_delete && r.on_delete !== "NO ACTION" && <Badge variant="outline">ON DELETE {r.on_delete}</Badge>}
    </li>
  );
  const none = <p className="px-4 py-6 text-sm text-muted-foreground">None.</p>;
  void selfId;
  return (
    <div className="space-y-5">
      <div>
        <h3 className="mb-2 text-sm font-semibold">References (outgoing)</h3>
        <div className="surface">{outgoing.length ? <ul className="divide-y">{outgoing.map((r) => <Row key={r.id} r={r} dir="out" />)}</ul> : none}</div>
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold">Referenced by (incoming)</h3>
        <div className="surface">{incoming.length ? <ul className="divide-y">{incoming.map((r) => <Row key={r.id} r={r} dir="in" />)}</ul> : none}</div>
      </div>
      <p className="text-xs text-muted-foreground">Only explicitly declared foreign keys are marked as such. QueryPilot never invents foreign keys; inferred links are labelled and kept separate.</p>
    </div>
  );
}

export function IndexesAndConstraints({ indexes, constraints }: { indexes: IndexRow[]; constraints: ConstraintRow[] }) {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="mb-2 text-sm font-semibold">Indexes</h3>
        {indexes.length === 0 ? <p className="text-sm text-muted-foreground">No indexes captured.</p> : (
          <div className="surface overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="border-b text-left text-xs text-muted-foreground"><tr>{["Name", "Type", "Key columns", "Included", "Flags"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y">
                {indexes.map((i) => (
                  <tr key={i.id}>
                    <td className="px-3 py-2 font-medium">{i.name}</td>
                    <td className="px-3 py-2 text-xs">{i.index_type ?? "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs">{i.key_columns.map((c) => `${c.name}${c.descending ? " DESC" : ""}`).join(", ")}</td>
                    <td className="px-3 py-2 font-mono text-xs">{i.included_columns.join(", ") || "—"}</td>
                    <td className="px-3 py-2"><span className="flex flex-wrap gap-1">{i.is_primary_key && <Badge>PK</Badge>}{i.is_unique_constraint && <Badge variant="secondary">UNIQUE constraint</Badge>}{i.is_unique && !i.is_primary_key && !i.is_unique_constraint && <Badge variant="secondary">unique</Badge>}{i.filter_definition && <Badge variant="outline" title={i.filter_definition}>filtered</Badge>}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold">Constraints</h3>
        {constraints.length === 0 ? <p className="text-sm text-muted-foreground">No constraints captured.</p> : (
          <ul className="surface divide-y">
            {constraints.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <Badge variant="secondary">{c.constraint_type.replace("_", " ")}</Badge>
                <span className="font-mono text-xs text-muted-foreground">{c.name ?? "(unnamed)"}</span>
                <span className="font-mono text-xs">{c.expression ?? `(${c.columns.join(", ")})`}</span>
                {c.constraint_type === "default" && c.columns[0] && <span className="text-xs text-muted-foreground">for {c.columns[0]}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const KIND_LABEL: Record<string, string> = { reads: "Reads", writes: "Modifies", executes: "Executes", calls_function: "Calls function", references: "References", trigger_on: "Trigger on" };

export function DependencyList({ title, deps, names, direction }: { title: string; deps: DependencyRow[]; names: NameMap; direction: "out" | "in" }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">{title} <span className="font-normal text-muted-foreground">({deps.length})</span></h3>
      {deps.length === 0 ? <p className="surface px-4 py-6 text-sm text-muted-foreground">None found.</p> : (
        <ul className="surface divide-y">
          {deps.map((d) => {
            const otherId = direction === "out" ? d.target_object_id : d.source_object_id;
            const other = otherId ? names[otherId] : undefined;
            return (
              <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                <Badge variant={d.kind === "writes" ? "danger" : "secondary"} className="w-24 justify-center">{KIND_LABEL[d.kind] ?? d.kind}</Badge>
                {other && otherId ? <ObjectLink type={other.type} id={otherId} schema={other.schema} name={other.name} /> : <span className="font-mono text-xs">{[d.target_schema, d.target_name].filter(Boolean).join(".") || "(dynamic SQL)"}</span>}
                {d.operations.length > 0 && <span className="text-xs text-muted-foreground">{d.operations.join(" · ")}</span>}
                <span className="ml-auto flex items-center gap-2"><ConfidenceBadge confidence={d.confidence} />{d.line ? <span className="text-xs text-muted-foreground">line {d.line}</span> : null}</span>
                {d.note && <p className="basis-full pl-[6.5rem] text-xs text-muted-foreground">{d.note}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
