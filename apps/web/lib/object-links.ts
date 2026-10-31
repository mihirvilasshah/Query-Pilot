const ROUTES: Record<string, string> = { table: "tables", view: "views", procedure: "procedures", function: "functions" };

/** Route to the detail page of a database object (triggers have an inline explorer instead). */
export function objectHref(type: string, id: string, name?: string): string {
  const r = ROUTES[type];
  if (r) return `/database-intelligence/${r}/${id}`;
  if (type === "trigger") return `/database-intelligence/triggers?q=${encodeURIComponent(name ?? "")}`;
  return "/database-intelligence";
}
