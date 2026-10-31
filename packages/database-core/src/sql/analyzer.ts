import type { RiskLevel, SqlDialect } from "@querypilot/shared-types";
import { RISK_ORDER } from "@querypilot/shared-types";
import { splitBatches, tokenize, type Token } from "./tokenizer";

export type StatementKind =
  | "select"
  | "insert"
  | "update"
  | "delete"
  | "merge"
  | "create"
  | "alter"
  | "drop"
  | "truncate"
  | "exec"
  | "declare"
  | "set"
  | "transaction"
  | "control"
  | "grant"
  | "other";

export type ReferenceAccess = "read" | "write" | "ddl" | "execute";

export interface ObjectReference {
  /** Name as written, parts joined with '.' (e.g. dbo.Orders). */
  fullName: string;
  parts: string[];
  name: string;
  schema?: string;
  kind: "table" | "procedure" | "function" | "unknown";
  access: ReferenceAccess;
  /** select | insert | update | delete | merge | truncate | create | alter | drop | exec | call */
  operation: string;
  isTemporary: boolean;
  isTableVariable: boolean;
  columns: string[];
  line: number;
}

export interface Finding {
  id: string;
  severity: RiskLevel;
  title: string;
  description: string;
  recommendation: string;
  saferAlternative?: string;
  statementIndex: number;
  line: number;
  /** "certain" = derived from tokens with no guessing; "heuristic" = pattern-based and may be a false positive. */
  confidence: "certain" | "heuristic";
}

export interface StatementInfo {
  index: number;
  kind: StatementKind;
  /** e.g. "table", "procedure", "view" for CREATE/ALTER/DROP. */
  objectType?: string;
  startLine: number;
  endLine: number;
  text: string;
  references: ObjectReference[];
  hasWhere: boolean;
  hasJoin: boolean;
  usesSelectStar: boolean;
  isDynamicSql: boolean;
  /** Statements nested inside a CREATE/ALTER routine body. */
  children: StatementInfo[];
  /** Plain-language statement of what the statement can touch. */
  dataImpact?: string;
  /** SELECT that previews the rows a simple UPDATE/DELETE would affect. */
  previewSql?: string;
}

export interface TableImpact {
  fullName: string;
  isTemporary: boolean;
  operations: string[];
  columns: string[];
  readOnly: boolean;
}

export interface SqlAnalysisResult {
  dialect: SqlDialect;
  statements: StatementInfo[];
  /** Flat list of every statement including routine bodies. */
  allStatements: StatementInfo[];
  findings: Finding[];
  overallRisk: RiskLevel;
  tablesAffected: TableImpact[];
  routinesCalled: string[];
  statementCounts: Record<string, number>;
  batchCount: number;
  parseWarnings: string[];
  limitations: string[];
}

const ROUTINE_TYPES = new Set(["PROC", "PROCEDURE", "FUNCTION", "TRIGGER", "VIEW"]);

const STARTERS = new Set([
  "SELECT", "INSERT", "UPDATE", "DELETE", "MERGE", "TRUNCATE", "DROP", "CREATE", "ALTER", "EXEC", "EXECUTE",
  "DECLARE", "BEGIN", "END", "COMMIT", "ROLLBACK", "SAVE", "IF", "ELSE", "WHILE", "RETURN", "PRINT", "RAISERROR",
  "THROW", "GRANT", "REVOKE", "DENY", "SET", "USE", "WITH", "OPEN", "CLOSE", "FETCH", "DEALLOCATE", "BREAK",
  "CONTINUE", "WAITFOR", "GOTO", "DBCC", "KILL", "SHUTDOWN", "RECONFIGURE", "BACKUP", "RESTORE",
]);

const AFTER_TABLE_STOP = new Set([
  "WHERE", "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "CROSS", "OUTER", "ON", "GROUP", "ORDER", "HAVING", "UNION",
  "EXCEPT", "INTERSECT", "SET", "WITH", "OPTION", "FOR", "USING", "WHEN", "OUTPUT", "VALUES", "OFFSET", "LIMIT",
  "NATURAL", "APPLY", "PIVOT", "UNPIVOT", "TABLESAMPLE", "FETCH", "WINDOW", "AS", "RETURNING", "THEN", "ELSE", "END",
  "SELECT", "INSERT", "UPDATE", "DELETE", "MERGE", "TRUNCATE", "DROP", "CREATE", "ALTER", "EXEC", "EXECUTE",
  "DECLARE", "BEGIN", "COMMIT", "ROLLBACK", "IF", "WHILE", "RETURN", "PRINT", "GRANT", "REVOKE", "DENY", "GO",
  "FROM", "INTO", "AND", "OR", "NOT", "IN", "IS", "LIKE", "BETWEEN", "ALL", "ANY", "EXISTS",
]);

const BUILTIN_OBJECT_PREFIXES = ["sys.", "information_schema."];

interface SplitState {
  caseOpen: number;
}

function isCtePattern(tokens: Token[], i: number): boolean {
  const a = tokens[i + 1];
  if (!a || !(a.type === "word" || a.type === "ident")) return false;
  let j = i + 2;
  if (tokens[j]?.value === "(") {
    let depth = 0;
    for (; j < tokens.length; j++) {
      const v = tokens[j]!.value;
      if (v === "(") depth++;
      else if (v === ")") {
        depth--;
        if (depth === 0) {
          j++;
          break;
        }
      }
    }
  }
  return tokens[j]?.upper === "AS" && tokens[j + 1]?.value === "(";
}

function routineType(stmt: Token[]): string | undefined {
  const first = stmt[0]?.upper;
  if (first !== "CREATE" && first !== "ALTER") return undefined;
  for (let k = 1; k < Math.min(stmt.length, 8); k++) {
    const u = stmt[k]!.upper;
    if (ROUTINE_TYPES.has(u)) return u === "PROC" ? "PROCEDURE" : u;
    if (["TABLE", "INDEX", "SCHEMA", "DATABASE", "SEQUENCE", "TYPE", "SYNONYM", "LOGIN", "USER", "ROLE"].includes(u)) return undefined;
  }
  return undefined;
}

/** Splits one GO batch into top-level statements (T-SQL does not require semicolons). */
export function splitStatements(tokens: Token[]): Token[][] {
  const out: Token[][] = [];
  if (tokens.length === 0) return out;
  const baseDepth = tokens[0]!.depth;
  let cur: Token[] = [];
  const state: SplitState = { caseOpen: 0 };

  const flush = () => {
    if (cur.length > 0) out.push(cur);
    cur = [];
    state.caseOpen = 0;
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const prev = cur[cur.length - 1];

    if (t.type === "punct" && t.value === ";" && t.depth === baseDepth) {
      if (routineType(cur) && cur.length > 0) {
        cur.push(t);
        continue;
      }
      cur.push(t);
      flush();
      continue;
    }

    if (t.type === "word") {
      if (t.upper === "CASE") state.caseOpen++;
      if (t.upper === "END" && state.caseOpen > 0) {
        state.caseOpen--;
        cur.push(t);
        continue;
      }
    }

    if (cur.length > 0 && t.type === "word" && t.depth === baseDepth && STARTERS.has(t.upper) && !(t.upper === "ELSE" && state.caseOpen > 0)) {
      const first = cur[0]!.upper;
      const routine = routineType(cur);
      let isNew = true;

      if (routine) {
        isNew = false; // a routine body runs to the end of the batch
      } else if (first === "ELSE" && cur.length === 1) {
        isNew = true;
      } else {
        const p = prev?.upper ?? "";
        switch (t.upper) {
          case "SELECT": {
            const hasVerb = cur.some((x) => x.depth === baseDepth && ["SELECT", "INSERT", "UPDATE", "DELETE", "MERGE"].includes(x.upper));
            const insertHasSource = cur.some((x) => x.depth === baseDepth && ["SELECT", "VALUES", "EXEC", "EXECUTE", "DEFAULT"].includes(x.upper));
            isNew = !(
              ["UNION", "ALL", "INTERSECT", "EXCEPT", "AS", "FOR", "IS"].includes(p) ||
              (first === "INSERT" && !insertHasSource) ||
              (first === "RETURN" && cur.length === 1) ||
              (first === "WITH" && !hasVerb)
            );
            break;
          }
          case "INSERT":
          case "UPDATE":
          case "DELETE":
            isNew = !(first === "MERGE" || ["THEN", "FOR", "OF", "ON", "AFTER", "INSTEAD"].includes(p));
            if (first === "WITH" && !cur.some((x) => x.depth === baseDepth && ["SELECT", "INSERT", "UPDATE", "DELETE", "MERGE"].includes(x.upper))) isNew = false;
            break;
          case "MERGE":
            isNew = !(["INNER", "LEFT", "RIGHT", "FULL", "OUTER", "CROSS"].includes(p));
            if (first === "WITH" && !cur.some((x) => x.depth === baseDepth && ["SELECT", "INSERT", "UPDATE", "DELETE", "MERGE"].includes(x.upper))) isNew = false;
            break;
          case "CREATE":
          case "ALTER":
            isNew = !(["OR", "GRANT", "DENY", "REVOKE", ","].includes(p));
            break;
          case "DROP":
            isNew = first !== "ALTER";
            break;
          case "SET":
            isNew = !(first === "UPDATE" || first === "ALTER" || first === "MERGE" || p === "THEN" || (first === "WITH" && cur.some((x) => x.upper === "UPDATE")));
            break;
          case "EXEC":
          case "EXECUTE":
            isNew = !(
              (first === "INSERT" && !cur.some((x) => x.depth === baseDepth && ["SELECT", "VALUES", "EXEC", "EXECUTE"].includes(x.upper))) ||
              ["WITH", "AS", "AND"].includes(p)
            );
            break;
          case "WITH":
            isNew = isCtePattern(tokens, i);
            break;
          case "GRANT":
            isNew = p !== "WITH";
            break;
          case "IF":
            // DROP TABLE IF EXISTS / CREATE TABLE IF NOT EXISTS
            isNew = !(
              ["DROP", "CREATE", "ALTER"].includes(first) &&
              ["TABLE", "VIEW", "PROC", "PROCEDURE", "FUNCTION", "TRIGGER", "INDEX", "SCHEMA", "DATABASE", "SEQUENCE", "TYPE", "SYNONYM", "COLUMN", "CONSTRAINT"].includes(p)
            );
            break;
          case "FETCH":
            isNew = !(["ROW", "ROWS"].includes(p));
            break;
          case "END":
            isNew = true;
            break;
          case "OPEN":
          case "CLOSE":
          case "USE":
          case "SAVE":
          case "KILL":
            isNew = !(["WITH", "FOR", "ON"].includes(p));
            break;
          default:
            isNew = true;
        }
      }
      if (isNew) flush();
    }
    cur.push(t);
  }
  flush();
  return out;
}

function classify(stmt: Token[]): { kind: StatementKind; objectType?: string } {
  const base = stmt[0]?.depth ?? 0;
  let first = stmt[0]?.upper ?? "";
  let idx = 0;
  if (first === "WITH" || first === ";") {
    // CTE: the real verb follows the CTE definitions
    for (let k = 0; k < stmt.length; k++) {
      const t = stmt[k]!;
      if (t.depth === base && t.type === "word" && ["SELECT", "INSERT", "UPDATE", "DELETE", "MERGE"].includes(t.upper)) {
        first = t.upper;
        idx = k;
        break;
      }
    }
  }
  const second = stmt[idx + 1]?.upper ?? "";
  switch (first) {
    case "SELECT": return { kind: "select" };
    case "INSERT": return { kind: "insert" };
    case "UPDATE": return second === "STATISTICS" ? { kind: "other" } : { kind: "update" };
    case "DELETE": return { kind: "delete" };
    case "MERGE": return { kind: "merge" };
    case "TRUNCATE": return { kind: "truncate", objectType: "table" };
    case "EXEC":
    case "EXECUTE": return { kind: "exec" };
    case "DECLARE": return { kind: "declare" };
    case "SET": return { kind: "set" };
    case "COMMIT":
    case "ROLLBACK":
    case "SAVE": return { kind: "transaction" };
    case "BEGIN":
      return ["TRAN", "TRANSACTION", "DISTRIBUTED"].includes(second) ? { kind: "transaction" } : { kind: "control" };
    case "IF": case "ELSE": case "WHILE": case "RETURN": case "END": case "BREAK": case "CONTINUE": case "GOTO":
    case "PRINT": case "RAISERROR": case "THROW": case "WAITFOR": case "USE":
      return { kind: "control" };
    case "GRANT": case "REVOKE": case "DENY": return { kind: "grant" };
    case "CREATE":
    case "ALTER":
    case "DROP": {
      const kind = first.toLowerCase() as StatementKind;
      for (let k = idx + 1; k < Math.min(stmt.length, idx + 8); k++) {
        const u = stmt[k]!.upper;
        const known = ["TABLE", "VIEW", "PROC", "PROCEDURE", "FUNCTION", "TRIGGER", "INDEX", "SCHEMA", "DATABASE", "SEQUENCE", "TYPE", "SYNONYM", "LOGIN", "USER", "ROLE", "STATISTICS"];
        if (known.includes(u)) return { kind, objectType: u === "PROC" ? "procedure" : u.toLowerCase() };
      }
      return { kind };
    }
    default: return { kind: "other" };
  }
}

interface Source {
  parts: string[];
  end: number;
  type: "name" | "temp" | "variable";
}

function parseQualifiedName(toks: Token[], i: number): Source | null {
  const first = toks[i];
  if (!first) return null;
  if (first.type === "temp") return { parts: [first.value], end: i + 1, type: "temp" };
  if (first.type === "variable") return { parts: [first.value], end: i + 1, type: "variable" };
  if (!(first.type === "word" || first.type === "ident")) return null;
  const parts: string[] = [];
  let j = i;
  for (;;) {
    const t = toks[j];
    if (!t || !(t.type === "word" || t.type === "ident")) break;
    parts.push(t.type === "ident" ? t.upper : t.value);
    j++;
    if (toks[j]?.value === ".") {
      j++;
      if (toks[j]?.value === ".") {
        parts.push("");
        j++;
      }
      continue;
    }
    break;
  }
  return parts.length ? { parts, end: j, type: "name" } : null;
}

function makeRef(
  src: Source,
  access: ReferenceAccess,
  operation: string,
  line: number,
  kind: ObjectReference["kind"] = "table",
): ObjectReference {
  const named = src.parts;
  const name = named[named.length - 1] ?? "";
  const schema = named.length >= 2 ? named[named.length - 2] || undefined : undefined;
  return {
    fullName: named.join("."),
    parts: named,
    name,
    ...(schema ? { schema } : {}),
    kind,
    access,
    operation,
    isTemporary: src.type === "temp",
    isTableVariable: src.type === "variable",
    columns: [],
    line,
  };
}

interface Extraction {
  references: ObjectReference[];
  hasWhere: boolean;
  hasJoin: boolean;
  usesSelectStar: boolean;
  maxSubqueryDepth: number;
  nullComparisons: { line: number }[];
  notInSubquery: { line: number }[];
  leadingWildcardLike: { line: number }[];
  noLockHints: { line: number }[];
  crossJoins: { line: number }[];
  implicitJoins: { line: number }[];
  joinCount: number;
  whereTautology: boolean;
  insertWithoutColumnList: boolean;
  dropColumn: string[];
  alterColumn: string[];
}

function emptyExtraction(): Extraction {
  return {
    references: [], hasWhere: false, hasJoin: false, usesSelectStar: false, maxSubqueryDepth: 0,
    nullComparisons: [], notInSubquery: [], leadingWildcardLike: [], noLockHints: [], crossJoins: [],
    implicitJoins: [], joinCount: 0, whereTautology: false, insertWithoutColumnList: false, dropColumn: [], alterColumn: [],
  };
}

function isNameToken(t: Token | undefined): boolean {
  return !!t && (t.type === "word" || t.type === "ident" || t.type === "temp" || t.type === "variable");
}

/** Walks one statement's tokens and extracts referenced objects and syntactic risk indicators. */
function extract(stmt: Token[], kind: StatementKind, objectType: string | undefined): Extraction {
  const ex = emptyExtraction();
  const base = stmt[0]?.depth ?? 0;
  const cteNames = new Set<string>();
  const aliasMap = new Map<string, string>();
  const parenOpeners: (Token | undefined)[] = [];
  let writeTargetHandled = false;
  let deleteTarget: ObjectReference | undefined;

  // CTE names
  if (stmt[0]?.upper === "WITH" || (stmt[0]?.value === ";" && stmt[1]?.upper === "WITH")) {
    for (let i = 0; i < stmt.length; i++) {
      const t = stmt[i]!;
      if (t.depth === base && (t.upper === "WITH" || t.value === ",") && isCtePattern(stmt, i)) {
        cteNames.add(stmt[i + 1]!.type === "ident" ? stmt[i + 1]!.upper.toLowerCase() : stmt[i + 1]!.value.toLowerCase());
      }
    }
  }

  const addRef = (ref: ObjectReference) => {
    if (cteNames.has(ref.name.toLowerCase()) && ref.parts.length === 1) return;
    ex.references.push(ref);
  };

  const skipHintsAndAlias = (j: number, ref: ObjectReference | undefined): number => {
    let k = j;
    // alias
    if (stmt[k]?.upper === "AS" && isNameToken(stmt[k + 1])) {
      if (ref) aliasMap.set(stmt[k + 1]!.upper.toLowerCase(), ref.fullName);
      k += 2;
    } else if (stmt[k] && (stmt[k]!.type === "ident" || (stmt[k]!.type === "word" && !AFTER_TABLE_STOP.has(stmt[k]!.upper)))) {
      if (ref) aliasMap.set((stmt[k]!.type === "ident" ? stmt[k]!.upper : stmt[k]!.upper).toLowerCase(), ref.fullName);
      k += 1;
    }
    // table hints
    if (stmt[k]?.upper === "WITH" && stmt[k + 1]?.value === "(") {
      const line = stmt[k]!.line;
      let d = 0;
      let m = k + 1;
      for (; m < stmt.length; m++) {
        if (stmt[m]!.value === "(") d++;
        else if (stmt[m]!.value === ")") {
          d--;
          if (d === 0) break;
        }
        if (/^(NOLOCK|READUNCOMMITTED)$/i.test(stmt[m]!.value)) ex.noLockHints.push({ line });
      }
      k = m + 1;
    }
    return k;
  };

  const parseSourceList = (start: number, access: ReferenceAccess, operation: string, allowComma: boolean): number => {
    let j = start;
    for (;;) {
      const t = stmt[j];
      if (!t) return j;
      if (t.value === "(") return j; // derived table; inner tokens are scanned by the main loop
      const src = parseQualifiedName(stmt, j);
      if (!src) return j;
      // table-valued function call
      if (stmt[src.end]?.value === "(" && src.type === "name") {
        const ref = makeRef(src, "execute", "call", t.line, "function");
        addRef(ref);
        // skip the call's argument list so that it is not scanned as a source
        let d = 0;
        let m = src.end;
        for (; m < stmt.length; m++) {
          if (stmt[m]!.value === "(") d++;
          else if (stmt[m]!.value === ")") {
            d--;
            if (d === 0) break;
          }
        }
        j = skipHintsAndAlias(m + 1, undefined);
      } else {
        const ref = makeRef(src, access, operation, t.line);
        addRef(ref);
        j = skipHintsAndAlias(src.end, ref);
      }
      if (allowComma && stmt[j]?.value === "," && stmt[j]?.depth === t.depth) {
        ex.implicitJoins.push({ line: t.line });
        j++;
        continue;
      }
      return j;
    }
  };

  for (let i = 0; i < stmt.length; i++) {
    const t = stmt[i]!;
    const prev = stmt[i - 1];
    const atBase = t.depth === base;

    if (t.value === "(") parenOpeners.push(prev);
    if (t.value === ")") parenOpeners.pop();

    // subquery nesting
    if (t.upper === "SELECT" && t.type === "word") {
      ex.maxSubqueryDepth = Math.max(ex.maxSubqueryDepth, t.depth - base);
    }

    if (t.type === "word") {
      const u = t.upper;
      if (u === "WHERE" && atBase) {
        ex.hasWhere = true;
        // WHERE 1 = 1 and nothing else
        const a = stmt[i + 1];
        const op = stmt[i + 2];
        const b = stmt[i + 3];
        const after = stmt[i + 4];
        if (a?.value === "1" && op?.value === "=" && b?.value === "1" && (!after || after.value === ";" || STARTERS.has(after.upper))) {
          ex.whereTautology = true;
        }
      }
      if (u === "JOIN" || u === "APPLY") {
        ex.hasJoin = true;
        ex.joinCount++;
        if (prev?.upper === "CROSS" && u === "JOIN") ex.crossJoins.push({ line: t.line });
      }

      // FROM <source list>
      if (u === "FROM" && kind !== "other" && kind !== "declare" && kind !== "control" || (u === "FROM" && kind === "control")) {
        const opener = t.depth > base ? parenOpeners[parenOpeners.length - 1] : undefined;
        const inFunc = opener && ["EXTRACT", "TRIM", "SUBSTRING", "OVERLAY", "POSITION"].includes(opener.upper);
        if (!inFunc && prev?.upper !== "DISTINCT" && kind !== "truncate") {
          if (kind === "delete" && atBase && !writeTargetHandled) {
            // DELETE FROM <target>
            const src = parseQualifiedName(stmt, i + 1);
            if (src) {
              const ref = makeRef(src, "write", "delete", t.line);
              ref.operation = "delete";
              addRef(ref);
              deleteTarget = ref;
              writeTargetHandled = true;
              i = skipHintsAndAlias(src.end, ref) - 1;
              continue;
            }
          } else {
            const next = parseSourceList(i + 1, "read", "select", true);
            i = next - 1;
            continue;
          }
        }
      }
      if (u === "JOIN" || u === "APPLY") {
        const next = parseSourceList(i + 1, "read", "select", false);
        i = next - 1;
        continue;
      }

      // write targets
      if (atBase && !writeTargetHandled) {
        if (u === "INSERT" && kind === "insert") {
          let j = i + 1;
          if (stmt[j]?.upper === "INTO") j++;
          const src = parseQualifiedName(stmt, j);
          if (src) {
            const ref = makeRef(src, "write", "insert", t.line);
            if (stmt[src.end]?.value === "(") {
              let d = 0;
              for (let m = src.end; m < stmt.length; m++) {
                const v = stmt[m]!;
                if (v.value === "(") d++;
                else if (v.value === ")") {
                  d--;
                  if (d === 0) break;
                } else if (d === 1 && (v.type === "word" || v.type === "ident")) ref.columns.push(v.type === "ident" ? v.upper : v.value);
              }
            } else if (stmt[src.end]?.upper === "VALUES" || stmt[src.end]?.upper === "SELECT" || stmt[src.end]?.upper === "EXEC") {
              ex.insertWithoutColumnList = true;
            }
            addRef(ref);
            writeTargetHandled = true;
            i = src.end - 1;
            continue;
          }
        }
        if (u === "UPDATE" && kind === "update") {
          const src = parseQualifiedName(stmt, i + 1);
          if (src && src.parts[0]?.toUpperCase() !== "TOP") {
            const ref = makeRef(src, "write", "update", t.line);
            // SET col = ...
            let k = src.end;
            while (k < stmt.length && !(stmt[k]!.upper === "SET" && stmt[k]!.depth === base)) k++;
            let expectCol = true;
            for (k = k + 1; k < stmt.length; k++) {
              const v = stmt[k]!;
              if (v.depth === base && v.type === "word" && ["FROM", "WHERE", "OUTPUT", "OPTION"].includes(v.upper)) break;
              if (v.depth === base && v.value === ",") {
                expectCol = true;
                continue;
              }
              if (expectCol && v.depth === base && (v.type === "word" || v.type === "ident" || v.type === "variable")) {
                const p = parseQualifiedName(stmt, k);
                if (p && stmt[p.end]?.type === "op" && /=$/.test(stmt[p.end]!.value)) {
                  if (p.type === "name") ref.columns.push(p.parts[p.parts.length - 1]!);
                  k = p.end;
                }
                expectCol = false;
              }
            }
            addRef(ref);
            deleteTarget = ref; // reuse alias resolution
            writeTargetHandled = true;
            i = src.end - 1;
            continue;
          }
        }
        if (u === "DELETE" && kind === "delete" && stmt[i + 1]?.upper !== "FROM") {
          const src = parseQualifiedName(stmt, i + 1);
          if (src) {
            const ref = makeRef(src, "write", "delete", t.line);
            addRef(ref);
            deleteTarget = ref;
            writeTargetHandled = true;
            i = src.end - 1;
            continue;
          }
        }
        if (u === "MERGE" && kind === "merge") {
          let j = i + 1;
          if (stmt[j]?.upper === "INTO") j++;
          const src = parseQualifiedName(stmt, j);
          if (src) {
            const ref = makeRef(src, "write", "merge", t.line);
            addRef(ref);
            writeTargetHandled = true;
            i = skipHintsAndAlias(src.end, ref) - 1;
            continue;
          }
        }
        if (u === "USING" && kind === "merge") {
          const next = parseSourceList(i + 1, "read", "select", false);
          i = next - 1;
          continue;
        }
      }
      if (u === "USING" && kind === "merge" && writeTargetHandled) {
        const next = parseSourceList(i + 1, "read", "select", false);
        i = next - 1;
        continue;
      }

      if (u === "TRUNCATE" && kind === "truncate") {
        const j = stmt[i + 1]?.upper === "TABLE" ? i + 2 : i + 1;
        const src = parseQualifiedName(stmt, j);
        if (src) {
          addRef(makeRef(src, "write", "truncate", t.line));
          i = src.end - 1;
          continue;
        }
      }

      if (u === "INTO" && atBase && kind === "select") {
        const src = parseQualifiedName(stmt, i + 1);
        if (src && src.type !== "variable") {
          addRef(makeRef(src, "write", "insert", t.line));
          i = src.end - 1;
          continue;
        }
      }

      // DDL
      if ((kind === "create" || kind === "alter" || kind === "drop") && atBase && objectType) {
        const verb = kind;
        if (["TABLE", "VIEW", "PROC", "PROCEDURE", "FUNCTION", "TRIGGER", "SEQUENCE", "TYPE", "SYNONYM"].includes(u) && !writeTargetHandled) {
          let j = i + 1;
          if (stmt[j]?.upper === "IF" && stmt[j + 1]?.upper === "EXISTS") j += 2;
          if (stmt[j]?.upper === "IF" && stmt[j + 1]?.upper === "NOT") j += 3;
          const objKind: ObjectReference["kind"] = u === "TABLE" ? "table" : u === "PROC" || u === "PROCEDURE" ? "procedure" : u === "FUNCTION" ? "function" : "unknown";
          for (;;) {
            const src = parseQualifiedName(stmt, j);
            if (!src) break;
            addRef(makeRef(src, "ddl", verb, t.line, u === "VIEW" ? "table" : objKind));
            j = src.end;
            if (verb === "drop" && stmt[j]?.value === ",") {
              j++;
              continue;
            }
            break;
          }
          writeTargetHandled = true;
          i = j - 1;
          continue;
        }
        if (u === "ON" && objectType === "index" && !writeTargetHandled) {
          const src = parseQualifiedName(stmt, i + 1);
          if (src) {
            addRef(makeRef(src, "ddl", verb, t.line));
            writeTargetHandled = true;
            i = src.end - 1;
            continue;
          }
        }
        if (u === "ON" && objectType === "trigger" && !writeTargetHandled && verb !== "drop") {
          const src = parseQualifiedName(stmt, i + 1);
          if (src) {
            addRef(makeRef(src, "ddl", verb, t.line));
            i = src.end - 1;
            continue;
          }
        }
        if (verb === "alter" && objectType === "table") {
          if (u === "DROP" && stmt[i + 1]?.upper === "COLUMN") {
            for (let m = i + 2; m < stmt.length; m++) {
              const v = stmt[m]!;
              if (v.depth !== base || v.upper === "DROP" || v.upper === "ADD" || v.upper === "ALTER") break;
              if (v.value === ",") continue;
              if (v.type === "word" || v.type === "ident") ex.dropColumn.push(v.type === "ident" ? v.upper : v.value);
            }
          }
          if (u === "ALTER" && stmt[i + 1]?.upper === "COLUMN" && isNameToken(stmt[i + 2])) {
            ex.alterColumn.push(stmt[i + 2]!.type === "ident" ? stmt[i + 2]!.upper : stmt[i + 2]!.value);
          }
        }
      }

      // EXEC proc
      if ((u === "EXEC" || u === "EXECUTE") && kind === "exec" && atBase && !writeTargetHandled) {
        let j = i + 1;
        if (stmt[j]?.value === "(" || stmt[j]?.type === "variable" || stmt[j]?.type === "string") {
          writeTargetHandled = true; // dynamic SQL handled elsewhere
        } else {
          const src = parseQualifiedName(stmt, j);
          if (src) {
            addRef(makeRef(src, "execute", "exec", t.line, "procedure"));
            writeTargetHandled = true;
            i = src.end - 1;
            continue;
          }
        }
      }
    }

    // `= NULL`, `<> NULL`, `!= NULL`
    if (t.type === "op" && ["=", "<>", "!="].includes(t.value) && stmt[i + 1]?.upper === "NULL") {
      const inSet = kind === "update" || kind === "set";
      const afterSet = (() => {
        // `SET col = NULL` / `SET @v = NULL` assignments are legitimate
        for (let k = i - 1; k >= 0; k--) {
          const v = stmt[k]!;
          if (v.depth !== t.depth) continue;
          if (v.upper === "WHERE" || v.upper === "ON" || v.upper === "AND" || v.upper === "OR" || v.upper === "HAVING" || v.upper === "WHEN") return false;
          if (v.upper === "SET" || v.value === ",") return true;
          if (v.upper === "SELECT") return false;
        }
        return false;
      })();
      const isAssignment = t.value === "=" && (inSet && afterSet);
      if (!isAssignment && !(t.value === "=" && prev?.type === "variable" && (kind === "set" || kind === "select" || kind === "declare"))) {
        ex.nullComparisons.push({ line: t.line });
      }
    }

    // NOT IN (SELECT ...)
    if (t.type === "word" && t.upper === "IN" && prev?.upper === "NOT" && stmt[i + 1]?.value === "(" && stmt[i + 2]?.upper === "SELECT") {
      ex.notInSubquery.push({ line: t.line });
    }

    // LIKE '%...'
    if (t.type === "word" && t.upper === "LIKE" && stmt[i + 1]?.type === "string" && /^N?'%/.test(stmt[i + 1]!.value)) {
      ex.leadingWildcardLike.push({ line: t.line });
    }

    // SELECT *
    if (t.value === "*" && t.type === "op") {
      const opener = t.depth > base ? parenOpeners[parenOpeners.length - 1] : undefined;
      const insideExists = opener && opener.upper === "EXISTS";
      const insideCount = opener && ["COUNT", "COUNT_BIG"].includes(opener.upper);
      const p = prev;
      const isStarProjection =
        p && (["SELECT", "DISTINCT", "ALL"].includes(p.upper) || p.value === "," || p.value === "." || (p.value === ")" && /TOP/i.test(stmt[Math.max(0, i - 4)]?.upper ?? "")) || /^[0-9]+$/.test(p.value) && stmt[i - 2]?.upper === "TOP" || p.upper === "PERCENT");
      if (isStarProjection && !insideExists && !insideCount) {
        if (!(p.upper === "SELECT" && stmt[i + 1]?.value === ")")) ex.usesSelectStar = true;
      }
    }
  }

  // resolve alias targets for UPDATE alias / DELETE alias
  if (deleteTarget && deleteTarget.parts.length === 1) {
    const resolved = aliasMap.get(deleteTarget.name.toLowerCase());
    if (resolved && resolved.toLowerCase() !== deleteTarget.fullName.toLowerCase()) {
      const parts = resolved.split(".");
      deleteTarget.fullName = resolved;
      deleteTarget.parts = parts;
      deleteTarget.name = parts[parts.length - 1]!;
      if (parts.length > 1) deleteTarget.schema = parts[parts.length - 2]!;
    }
  }

  return ex;
}

interface DynamicInfo {
  isDynamic: boolean;
  dangerous: boolean;
  mitigatedByQuotename: boolean;
  line: number;
  executesVariable?: string;
  usesSpExecuteSql: boolean;
}

function detectDynamic(stmt: Token[], concatVars: Set<string>): DynamicInfo | null {
  for (let i = 0; i < stmt.length; i++) {
    const t = stmt[i]!;
    if (t.type !== "word") continue;
    if (t.upper === "EXEC" || t.upper === "EXECUTE") {
      const n = stmt[i + 1];
      if (!n) continue;
      if (n.value === "(") {
        // collect parenthesised argument
        let d = 0;
        const inner: Token[] = [];
        for (let m = i + 1; m < stmt.length; m++) {
          const v = stmt[m]!;
          if (v.value === "(") d++;
          if (v.value === ")") {
            d--;
            if (d === 0) break;
          }
          if (m > i + 1) inner.push(v);
        }
        const hasConcat = inner.some((v) => v.value === "+");
        const vars = inner.filter((v) => v.type === "variable");
        const dangerous = vars.some((v) => concatVars.has(v.upper)) || (hasConcat && vars.length > 0);
        const quotename = inner.some((v) => v.upper === "QUOTENAME");
        const hasOnlyLiteral = !hasConcat && vars.length === 0;
        return {
          isDynamic: true,
          dangerous: !hasOnlyLiteral && dangerous,
          mitigatedByQuotename: quotename,
          line: t.line,
          ...(vars[0] ? { executesVariable: vars[0].upper } : {}),
          usesSpExecuteSql: false,
        };
      }
      if (n.type === "variable") {
        return {
          isDynamic: true,
          dangerous: concatVars.has(n.upper),
          mitigatedByQuotename: false,
          line: t.line,
          executesVariable: n.upper,
          usesSpExecuteSql: false,
        };
      }
      if (n.type === "string") {
        return { isDynamic: true, dangerous: false, mitigatedByQuotename: false, line: t.line, usesSpExecuteSql: false };
      }
      const nm = parseQualifiedName(stmt, i + 1);
      if (nm && nm.parts[nm.parts.length - 1]!.toLowerCase() === "sp_executesql") {
        const v = stmt[nm.end];
        return {
          isDynamic: true,
          dangerous: !!v && v.type === "variable" && concatVars.has(v.upper),
          mitigatedByQuotename: false,
          line: t.line,
          ...(v?.type === "variable" ? { executesVariable: v.upper } : {}),
          usesSpExecuteSql: true,
        };
      }
    }
  }
  return null;
}

function collectConcatVars(stmt: Token[], into: Set<string>, kind: StatementKind): void {
  // SET @v = '...' + @x ...   /   SELECT @v = ...   /   DECLARE @v type = '...' + @x
  for (let i = 0; i < stmt.length - 2; i++) {
    const t = stmt[i]!;
    if (t.type !== "variable") continue;
    let opIndex = i + 1;
    if (kind === "declare") {
      // skip the data type: nvarchar ( max )
      while (opIndex < stmt.length && (stmt[opIndex]!.depth > t.depth || stmt[opIndex]!.type === "word" || stmt[opIndex]!.value === "(" || stmt[opIndex]!.value === ")")) opIndex++;
    }
    const op = stmt[opIndex];
    if (!op || !(op.type === "op" && (op.value === "=" || op.value === "+="))) continue;
    let sawString = op.value === "+=";
    let sawPlus = op.value === "+=";
    let sawVar = op.value === "+=";
    for (let k = opIndex + 1; k < stmt.length; k++) {
      const v = stmt[k]!;
      if (v.depth < t.depth) break;
      if (v.upper === "SET" || v.upper === "SELECT" || (v.type === "word" && STARTERS.has(v.upper) && v.depth === t.depth)) break;
      if (v.type === "string") sawString = true;
      if (v.value === "+") sawPlus = true;
      if (v.type === "variable") sawVar = true;
    }
    if (sawString && sawPlus && sawVar) into.add(t.upper);
  }
}

function describeImpact(info: StatementInfo): string | undefined {
  const writes = info.references.filter((r) => r.access === "write" || (r.access === "ddl" && r.kind === "table"));
  if (writes.length === 0) return undefined;
  const target = writes[0]!;
  const temp = target.isTemporary || target.isTableVariable;
  switch (info.kind) {
    case "update":
      return `${info.hasWhere ? "Modifies the rows matched by the WHERE clause" : "Modifies EVERY row"} in ${target.fullName}${target.columns.length ? ` (columns: ${target.columns.join(", ")})` : ""}${temp ? " (temporary object)" : ""}.`;
    case "delete":
      return `${info.hasWhere ? "Deletes the rows matched by the WHERE clause" : "Deletes EVERY row"} from ${target.fullName}${temp ? " (temporary object)" : ""}.`;
    case "insert":
      return `Adds rows to ${target.fullName}${target.columns.length ? ` (columns: ${target.columns.join(", ")})` : ""}.`;
    case "truncate":
      return `Removes all rows from ${target.fullName} and resets identity counters; cannot be filtered.`;
    case "merge":
      return `Inserts, updates and/or deletes rows in ${target.fullName} depending on the MERGE clauses.`;
    case "drop":
      return `Permanently removes ${writes.map((w) => w.fullName).join(", ")} and, for tables, all of its data.`;
    case "alter":
      return `Changes the definition of ${target.fullName}.`;
    case "create":
      return `Creates ${target.fullName}.`;
    case "select":
      return `Creates and populates ${target.fullName} (SELECT ... INTO).`;
    default:
      return undefined;
  }
}

function buildPreview(stmt: Token[], sql: string, info: StatementInfo): string | undefined {
  if (info.kind !== "update" && info.kind !== "delete") return undefined;
  if (info.hasJoin) return undefined;
  const target = info.references.find((r) => r.access === "write");
  if (!target) return undefined;
  const base = stmt[0]!.depth;
  const where = stmt.find((t) => t.upper === "WHERE" && t.depth === base);
  const endTok = stmt[stmt.length - 1]!;
  const wherePart = where ? ` ${sql.slice(where.start, endTok.end).replace(/;\s*$/, "")}` : "";
  return `SELECT COUNT(*) AS affected_rows FROM ${target.fullName}${wherePart};`;
}

class FindingBag {
  readonly list: Finding[] = [];
  add(f: Omit<Finding, "id">) {
    this.list.push({ id: `${f.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${this.list.length + 1}`, ...f });
  }
}

interface RunContext {
  sql: string;
  bag: FindingBag;
  concatVars: Set<string>;
  nextIndex: number;
  scriptHasTransaction: boolean;
  flat: StatementInfo[];
  inRoutine: boolean;
}

function analyzeTokens(stmt: Token[], ctx: RunContext): StatementInfo {
  const { kind, objectType } = classify(stmt);
  const index = ctx.nextIndex++;
  const ex = extract(stmt, kind, objectType);
  const startLine = stmt[0]!.line;
  const endLine = stmt[stmt.length - 1]!.line;
  const text = ctx.sql.slice(stmt[0]!.start, stmt[stmt.length - 1]!.end);

  collectConcatVars(stmt, ctx.concatVars, kind);
  const dyn = detectDynamic(stmt, ctx.concatVars);

  const info: StatementInfo = {
    index,
    kind,
    ...(objectType ? { objectType } : {}),
    startLine,
    endLine,
    text,
    references: ex.references,
    hasWhere: ex.hasWhere,
    hasJoin: ex.hasJoin,
    usesSelectStar: ex.usesSelectStar,
    isDynamicSql: !!dyn,
    children: [],
  };
  ctx.flat.push(info);

  // routine bodies
  const rType = routineType(stmt);
  if (rType) {
    let bodyStart = -1;
    const base = stmt[0]!.depth;
    for (let k = 1; k < stmt.length; k++) {
      const t = stmt[k]!;
      if (t.depth === base && t.upper === "AS" && t.type === "word" && stmt[k - 1]?.upper !== "EXECUTE" && stmt[k - 1]?.upper !== "CURSOR") {
        bodyStart = k + 1;
        break;
      }
    }
    if (bodyStart > 0 && bodyStart < stmt.length) {
      const body = stmt.slice(bodyStart);
      for (const s of splitStatements(body)) {
        info.children.push(analyzeTokens(s, { ...ctx, inRoutine: true }));
      }
      ctx.nextIndex = Math.max(ctx.nextIndex, ...info.children.map((c) => c.index + 1), ctx.nextIndex);
    }
  }

  info.dataImpact = describeImpact(info);
  const preview = buildPreview(stmt, ctx.sql, info);
  if (preview) info.previewSql = preview;

  evaluateRules(info, ex, dyn, ctx, stmt);
  return info;
}

function evaluateRules(info: StatementInfo, ex: Extraction, dyn: DynamicInfo | null, ctx: RunContext, stmt: Token[]) {
  const { bag } = ctx;
  const target = info.references.find((r) => r.access === "write" || r.access === "ddl");
  const targetIsTemp = !!target && (target.isTemporary || target.isTableVariable);
  const base = {
    statementIndex: info.index,
    line: info.startLine,
  };

  if ((info.kind === "update" || info.kind === "delete") && !info.hasWhere) {
    const verb = info.kind.toUpperCase();
    if (targetIsTemp) {
      bag.add({
        ...base, severity: "low", confidence: "certain",
        title: `${verb} without WHERE on a temporary object`,
        description: `${verb} has no WHERE clause, so it affects every row of ${target!.fullName}. This is a temporary object, so the blast radius is limited to the current session.`,
        recommendation: "Confirm that touching every row is intended.",
      });
    } else if (info.hasJoin) {
      bag.add({
        ...base, severity: "high", confidence: "certain",
        title: `${verb} with JOIN but no WHERE clause`,
        description: `${verb} on ${target?.fullName ?? "the target table"} has no WHERE clause. The JOIN limits rows to matches, but every matching row is affected and the join may duplicate or widen the match set.`,
        recommendation: "Add an explicit WHERE predicate, or verify the join cardinality with a SELECT first.",
        saferAlternative: info.previewSql ?? `Run a SELECT with the same FROM/JOIN to count the affected rows before executing the ${verb}.`,
      });
    } else {
      bag.add({
        ...base, severity: "critical", confidence: "certain",
        title: `${verb} without WHERE`,
        description: `${verb} on ${target?.fullName ?? "the target table"} has no WHERE clause and will affect every row in the table.`,
        recommendation: `Add a WHERE clause that identifies the intended rows. Run it inside a transaction and check @@ROWCOUNT before committing.`,
        saferAlternative: `SELECT COUNT(*) FROM ${target?.fullName ?? "<table>"} WHERE <condition>;  -- preview first\nBEGIN TRANSACTION;\n  -- ${verb} ... WHERE <condition>;\n  -- verify @@ROWCOUNT, then COMMIT or ROLLBACK\n`,
      });
    }
  }

  if (ex.whereTautology && (info.kind === "update" || info.kind === "delete")) {
    bag.add({
      ...base, severity: "critical", confidence: "certain",
      title: `${info.kind.toUpperCase()} with always-true WHERE (1 = 1)`,
      description: `The only predicate is 1 = 1, which matches every row. This is equivalent to having no WHERE clause.`,
      recommendation: "Replace the tautology with a real filter.",
    });
  }

  if (info.kind === "drop") {
    const what = info.objectType ?? "object";
    if (what === "database") {
      bag.add({ ...base, severity: "critical", confidence: "certain", title: "DROP DATABASE", description: "Permanently removes an entire database.", recommendation: "Take and verify a backup first; require a second reviewer." });
    } else if (what === "table") {
      bag.add({
        ...base, severity: "high", confidence: "certain", title: "DROP TABLE",
        description: `Permanently removes ${info.references.filter((r) => r.access === "ddl").map((r) => r.fullName).join(", ") || "a table"} and all of its data, indexes, triggers and constraints.`,
        recommendation: "Verify nothing depends on the table (views, procedures, foreign keys) and that a backup exists. Prefer renaming first and dropping later.",
        saferAlternative: "EXEC sp_rename '<table>', '<table>_deprecated';  -- drop after a quiet period",
      });
    } else {
      bag.add({ ...base, severity: "medium", confidence: "certain", title: `DROP ${what.toUpperCase()}`, description: `Removes a ${what}; dependent objects may break.`, recommendation: "Check dependencies before dropping and keep the original definition in source control." });
    }
  }

  if (info.kind === "truncate") {
    bag.add({
      ...base, severity: targetIsTemp ? "low" : "high", confidence: "certain", title: "TRUNCATE TABLE",
      description: `Removes every row from ${target?.fullName ?? "the table"} without logging individual deletes; it cannot be filtered, resets identity columns and is blocked by foreign keys.`,
      recommendation: "Make sure this is not production data you need; run inside a transaction when possible.",
    });
  }

  if (info.kind === "alter" && info.objectType === "table") {
    if (ex.dropColumn.length) {
      bag.add({
        ...base, severity: "high", confidence: "certain", title: "ALTER TABLE ... DROP COLUMN",
        description: `Drops column(s) ${ex.dropColumn.join(", ")} from ${target?.fullName ?? "the table"}. The data in the column is lost and any view, procedure or application using it will break.`,
        recommendation: "Search dependencies for the column first and keep a backup of the column's data.",
      });
    }
    if (ex.alterColumn.length) {
      bag.add({
        ...base, severity: "medium", confidence: "certain", title: "ALTER COLUMN",
        description: `Changes column(s) ${ex.alterColumn.join(", ")}. Narrowing a type or changing nullability can fail or truncate data.`,
        recommendation: "Check existing values against the new definition before applying the change.",
      });
    }
  }

  if (info.kind === "grant") {
    const txt = info.text.toUpperCase();
    if (/\bTO\s+PUBLIC\b/.test(txt) || /\bCONTROL\b/.test(txt) || /\bWITH\s+GRANT\s+OPTION\b/.test(txt)) {
      bag.add({ ...base, severity: "high", confidence: "heuristic", title: "Broad permission change", description: "Grants powerful permissions (PUBLIC, CONTROL or WITH GRANT OPTION).", recommendation: "Apply least privilege." });
    } else {
      bag.add({ ...base, severity: "informational", confidence: "certain", title: "Permission change", description: "Modifies database permissions.", recommendation: "Confirm the change is part of the reviewed deployment." });
    }
  }

  if (info.kind === "merge") {
    bag.add({
      ...base, severity: "medium", confidence: "heuristic", title: "MERGE statement",
      description: "MERGE combines insert/update/delete logic and is sensitive to concurrency (missing HOLDLOCK) and has well-known edge cases.",
      recommendation: "Use HOLDLOCK/SERIALIZABLE on the target or split into separate statements, and make sure the ON clause is unique.",
    });
  }

  if (info.usesSelectStar && (info.kind === "select" || info.kind === "insert")) {
    bag.add({
      ...base, severity: "low", confidence: "certain", title: "SELECT * usage",
      description: "SELECT * returns every column, so schema changes silently alter the result, extra data is transferred, and covering indexes cannot be used.",
      recommendation: "List the columns that are required.",
    });
  }

  if (ex.insertWithoutColumnList && info.kind === "insert") {
    bag.add({
      ...base, severity: "low", confidence: "certain", title: "INSERT without column list",
      description: "The INSERT depends on the physical column order of the table, which breaks when columns are added or reordered.",
      recommendation: "Provide an explicit column list.",
    });
  }

  for (const n of ex.nullComparisons) {
    bag.add({
      statementIndex: info.index, line: n.line, severity: "medium", confidence: "certain", title: "Comparison with NULL using = / <>",
      description: "Comparing to NULL with =, <> or != never evaluates to true (under ANSI_NULLS ON), so the predicate silently matches no rows.",
      recommendation: "Use IS NULL / IS NOT NULL.",
    });
  }
  for (const n of ex.notInSubquery) {
    bag.add({
      statementIndex: info.index, line: n.line, severity: "medium", confidence: "heuristic", title: "NOT IN (subquery) NULL hazard",
      description: "If the subquery returns any NULL, NOT IN returns no rows at all.",
      recommendation: "Use NOT EXISTS, or filter NULLs out of the subquery.",
    });
  }
  for (const n of ex.leadingWildcardLike) {
    bag.add({
      statementIndex: info.index, line: n.line, severity: "low", confidence: "heuristic", title: "LIKE with leading wildcard",
      description: "A pattern starting with % cannot use an index seek, forcing a scan.",
      recommendation: "Use full-text search or a different access pattern if the table is large.",
    });
  }
  for (const n of ex.noLockHints.slice(0, 1)) {
    bag.add({
      statementIndex: info.index, line: n.line, severity: "low", confidence: "certain", title: "NOLOCK / READUNCOMMITTED hint",
      description: "Allows dirty reads, duplicate rows and missing rows while data is moving.",
      recommendation: "Prefer READ_COMMITTED_SNAPSHOT or snapshot isolation.",
    });
  }
  for (const n of ex.crossJoins) {
    bag.add({
      statementIndex: info.index, line: n.line, severity: "medium", confidence: "certain", title: "CROSS JOIN",
      description: "Produces the Cartesian product of both inputs; row counts multiply.",
      recommendation: "Confirm a Cartesian product is intended, otherwise add a join predicate.",
    });
  }
  if (ex.implicitJoins.length > 0 && info.kind !== "other") {
    bag.add({
      statementIndex: info.index, line: ex.implicitJoins[0]!.line, severity: "low", confidence: "heuristic", title: "Comma-separated FROM list (implicit join)",
      description: "Old-style joins hide missing join predicates and silently become Cartesian products.",
      recommendation: "Use explicit JOIN ... ON syntax.",
    });
  }
  if (ex.joinCount >= 6) {
    bag.add({
      ...base, severity: "low", confidence: "heuristic", title: `Statement joins ${ex.joinCount} tables`,
      description: "Large join chains make cardinality estimates fragile and can be expensive.",
      recommendation: "Review the execution plan; consider staging intermediate results.",
    });
  }
  if (ex.maxSubqueryDepth >= 3) {
    bag.add({
      ...base, severity: ex.maxSubqueryDepth >= 4 ? "medium" : "low", confidence: "heuristic", title: `Nested subqueries (depth ${ex.maxSubqueryDepth})`,
      description: "Deeply nested subqueries are hard to maintain and can hinder optimization.",
      recommendation: "Refactor with CTEs or temporary tables.",
    });
  }

  // dynamic SQL / injection
  if (dyn) {
    if (dyn.dangerous) {
      bag.add({
        statementIndex: info.index, line: dyn.line,
        severity: dyn.mitigatedByQuotename ? "medium" : "high", confidence: "heuristic",
        title: "Dynamic SQL built by string concatenation",
        description: `Executes a SQL string assembled from variables${dyn.executesVariable ? ` (${dyn.executesVariable})` : ""}. Unvalidated input can change the meaning of the statement (SQL injection).${dyn.mitigatedByQuotename ? " QUOTENAME is used, which mitigates identifier injection, but values may still be injectable." : ""}`,
        recommendation: "Pass values through sp_executesql parameters and wrap identifiers with QUOTENAME(); validate against an allow-list.",
        saferAlternative: "EXEC sp_executesql @sql, N'@p1 int', @p1 = @value;",
      });
    } else if (dyn.usesSpExecuteSql) {
      bag.add({ statementIndex: info.index, line: dyn.line, severity: "informational", confidence: "certain", title: "Dynamic SQL via sp_executesql", description: "The statement text is only known at run time, so tables it touches cannot be resolved statically.", recommendation: "Make sure values are passed as parameters." });
    } else {
      bag.add({ statementIndex: info.index, line: dyn.line, severity: "medium", confidence: "certain", title: "Dynamic SQL executed with EXEC", description: "The executed text is only known at run time; objects it references are not visible to static analysis.", recommendation: "Prefer sp_executesql with parameters." });
    }
  }

  // injection signatures in literals and dangerous procs
  for (let i = 0; i < stmt.length; i++) {
    const t = stmt[i]!;
    if (t.type === "word" && t.upper === "OR") {
      const a = stmt[i + 1];
      const op = stmt[i + 2];
      const b = stmt[i + 3];
      if (a && b && op?.value === "=" && a.value === b.value && (a.type === "string" || a.type === "number")) {
        bag.add({ statementIndex: info.index, line: t.line, severity: "high", confidence: "heuristic", title: "Always-true OR condition (injection pattern)", description: `The predicate OR ${a.value} = ${b.value} is always true and makes the whole WHERE clause match every row. It is the classic SQL injection tautology.`, recommendation: "Remove it, and make sure no user input can produce it." });
        break;
      }
    }
  }
  for (const t of stmt) {
    if (t.type === "string") {
      const v = t.value;
      if (/'\s*(or|and)\s+'?\d+'?\s*=\s*'?\d+/i.test(v) || /;\s*(drop|delete|truncate|shutdown|exec)\b/i.test(v) || /\bunion\s+(all\s+)?select\b/i.test(v) || /--\s*'?$/.test(v)) {
        bag.add({ statementIndex: info.index, line: t.line, severity: "high", confidence: "heuristic", title: "SQL injection signature in a string literal", description: "A string literal contains a classic injection payload (tautology, stacked statement or UNION SELECT).", recommendation: "Verify the value is not produced from user input; never execute it." });
        break;
      }
    }
    if (t.type === "word" && ["XP_CMDSHELL", "OPENROWSET", "OPENDATASOURCE"].includes(t.upper)) {
      bag.add({ statementIndex: info.index, line: t.line, severity: "high", confidence: "certain", title: `Use of ${t.upper.toLowerCase()}`, description: `${t.upper.toLowerCase()} runs commands or reaches external data sources and is commonly abused.`, recommendation: "Avoid, or restrict through a least-privileged proxy." });
      break;
    }
  }

  // transaction control state
  if (info.kind === "transaction" && /^BEGIN/i.test(info.text)) ctx.scriptHasTransaction = true;
}

export interface AnalyzeOptions {
  dialect?: SqlDialect;
}

function maxRisk(findings: Finding[]): RiskLevel {
  for (const level of RISK_ORDER) {
    if (findings.some((f) => f.severity === level)) return level;
  }
  return "informational";
}

/**
 * Deterministic, token-based static analysis of a SQL script. It never executes SQL.
 * It is intentionally conservative: findings carry a confidence flag and anything that cannot be
 * resolved statically (dynamic SQL) is reported as such rather than guessed.
 */
export function analyzeSql(sql: string, options: AnalyzeOptions = {}): SqlAnalysisResult {
  const dialect = options.dialect ?? "tsql";
  const { tokens, unterminated } = tokenize(sql, { dialect });
  const batches = splitBatches(tokens);
  const bag = new FindingBag();
  const flat: StatementInfo[] = [];
  const ctx: RunContext = { sql, bag, concatVars: new Set(), nextIndex: 0, scriptHasTransaction: false, flat, inRoutine: false };
  const statements: StatementInfo[] = [];
  const parseWarnings: string[] = [];

  for (const u of unterminated) parseWarnings.push(`Unterminated ${u.kind} starting on line ${u.line}.`);

  for (const batch of batches) {
    ctx.concatVars.clear();
    for (const s of splitStatements(batch.tokens)) {
      statements.push(analyzeTokens(s, ctx));
    }
  }

  // script-level transaction rules
  const allStatements = flat;
  const writes = allStatements.filter((s) => ["insert", "update", "delete", "merge", "truncate", "drop", "alter"].includes(s.kind) && s.references.some((r) => (r.access === "write" || r.access === "ddl") && !r.isTemporary && !r.isTableVariable));
  const begins = allStatements.filter((s) => s.kind === "transaction" && /^BEGIN/i.test(s.text)).length;
  const ends = allStatements.filter((s) => s.kind === "transaction" && /^(COMMIT|ROLLBACK)/i.test(s.text)).length;
  const inRoutineOnly = statements.every((s) => s.kind === "create" || s.kind === "alter") && statements.some((s) => s.children.length > 0);

  if (writes.length > 0 && begins === 0 && !inRoutineOnly) {
    bag.add({
      statementIndex: writes[0]!.index, line: writes[0]!.startLine,
      severity: writes.length > 1 ? "medium" : "low", confidence: "heuristic",
      title: "No explicit transaction handling",
      description: `The script contains ${writes.length} data/schema-modifying statement(s) but no BEGIN TRANSACTION. A failure part-way through leaves the database partially modified.`,
      recommendation: "Wrap the modifications in BEGIN TRANSACTION ... COMMIT with TRY/CATCH and SET XACT_ABORT ON.",
      saferAlternative: "SET XACT_ABORT ON;\nBEGIN TRY\n  BEGIN TRANSACTION;\n  -- statements\n  COMMIT TRANSACTION;\nEND TRY\nBEGIN CATCH\n  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;\n  THROW;\nEND CATCH;",
    });
  }
  if (begins > ends) {
    const b = allStatements.find((s) => s.kind === "transaction" && /^BEGIN/i.test(s.text))!;
    bag.add({
      statementIndex: b.index, line: b.startLine, severity: "high", confidence: "heuristic",
      title: "Transaction may never be committed or rolled back",
      description: `Found ${begins} BEGIN TRANSACTION but only ${ends} COMMIT/ROLLBACK. An open transaction holds locks until the session ends.`,
      recommendation: "Make sure every code path commits or rolls back.",
    });
  }

  const findings = bag.list.sort((a, b) => RISK_ORDER.indexOf(a.severity) - RISK_ORDER.indexOf(b.severity) || a.line - b.line);

  // aggregate tables
  const tableMap = new Map<string, TableImpact>();
  const routines = new Set<string>();
  for (const s of allStatements) {
    for (const r of s.references) {
      if (r.kind === "procedure" || r.kind === "function") {
        if (r.access === "execute") routines.add(r.fullName);
        continue;
      }
      const key = r.fullName.toLowerCase();
      const entry = tableMap.get(key) ?? { fullName: r.fullName, isTemporary: r.isTemporary || r.isTableVariable, operations: [], columns: [], readOnly: true };
      if (!entry.operations.includes(r.operation)) entry.operations.push(r.operation);
      for (const c of r.columns) if (!entry.columns.includes(c)) entry.columns.push(c);
      if (r.access !== "read") entry.readOnly = false;
      tableMap.set(key, entry);
    }
  }

  const statementCounts: Record<string, number> = {};
  for (const s of allStatements) statementCounts[s.kind] = (statementCounts[s.kind] ?? 0) + 1;

  const limitations = [
    "Analysis is token-based and does not resolve names against a database; columns are reported only where syntactically visible.",
    "Tables referenced inside dynamic SQL strings are not resolved.",
  ];
  if (allStatements.some((s) => s.isDynamicSql)) limitations.push("This script contains dynamic SQL; the list of affected tables is not guaranteed to be complete.");
  if (dialect !== "tsql") limitations.push("Risk rules are tuned for T-SQL; other dialects may produce incomplete results.");

  return {
    dialect,
    statements,
    allStatements,
    findings,
    overallRisk: maxRisk(findings),
    tablesAffected: [...tableMap.values()],
    routinesCalled: [...routines],
    statementCounts,
    batchCount: batches.length,
    parseWarnings,
    limitations,
  };
}

export function isBuiltinObject(fullName: string): boolean {
  const l = fullName.toLowerCase();
  return BUILTIN_OBJECT_PREFIXES.some((p) => l.startsWith(p));
}
