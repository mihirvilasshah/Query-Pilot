export function formatDate(iso: string | null | undefined, withTime = false): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en", withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" }).format(d);
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (s < 60) return "just now";
  if (s < 3600) return rtf.format(-Math.floor(s / 60), "minute");
  if (s < 86400) return rtf.format(-Math.floor(s / 3600), "hour");
  if (s < 86400 * 30) return rtf.format(-Math.floor(s / 86400), "day");
  return formatDate(iso);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export const fullName = (o: { schema_name: string; name: string }) => (o.schema_name ? `${o.schema_name}.${o.name}` : o.name);

export function formatColumnType(c: { data_type: string; max_length: number | null; numeric_precision: number | null; numeric_scale: number | null }): string {
  const t = c.data_type.toLowerCase();
  if (["char", "varchar", "nchar", "nvarchar", "binary", "varbinary"].includes(t)) {
    if (c.max_length === -1) return `${t}(max)`;
    if (c.max_length != null) return `${t}(${c.max_length})`;
  }
  if (["decimal", "numeric"].includes(t) && c.numeric_precision != null) return `${t}(${c.numeric_precision},${c.numeric_scale ?? 0})`;
  if (["datetime2", "datetimeoffset", "time"].includes(t) && c.numeric_scale != null) return `${t}(${c.numeric_scale})`;
  return t;
}

export const pluralize = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
