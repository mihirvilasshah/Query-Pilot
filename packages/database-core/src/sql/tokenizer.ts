export type TokenType =
  | "word"
  | "ident" // [bracketed], "quoted" or `backticked` identifier
  | "string"
  | "number"
  | "variable" // @var / @@system
  | "temp" // #temp / ##global
  | "op"
  | "punct"
  | "go";

export interface Token {
  type: TokenType;
  /** Raw text exactly as written. */
  value: string;
  /** Upper-cased value for words (keywords), unquoted text for identifiers, raw otherwise. */
  upper: string;
  start: number;
  end: number;
  /** 1-based line of the first character. */
  line: number;
  /** Paren depth at the token (the depth *inside* which the token sits). */
  depth: number;
  /** Optional repeat count for GO n. */
  goCount?: number;
}

export interface TokenizeResult {
  tokens: Token[];
  /** Strings that were never closed - the script is not syntactically complete. */
  unterminated: { kind: "string" | "comment" | "identifier"; line: number }[];
}

const WORD_START = /[A-Za-z_\u0080-\uFFFF]/;
const WORD_PART = /[A-Za-z0-9_$@#\u0080-\uFFFF]/;

const OPERATOR_CHARS = new Set(["=", "<", ">", "!", "+", "-", "*", "/", "%", "&", "|", "^", "~", ":"]);

export interface TokenizeOptions {
  dialect?: "tsql" | "postgresql" | "mysql" | "sqlite";
}

/**
 * A lossless-enough SQL tokenizer: it understands comments (including nested T-SQL block comments),
 * single quoted strings with '' escapes, N'' strings, [bracket] / "double" / `back-tick` identifiers,
 * PostgreSQL dollar quoting, variables, temp tables and GO batch separators.
 * Whitespace and comments are dropped; offsets let callers slice the original text back out.
 */
export function tokenize(sql: string, options: TokenizeOptions = {}): TokenizeResult {
  const dialect = options.dialect ?? "tsql";
  const tokens: Token[] = [];
  const unterminated: TokenizeResult["unterminated"] = [];
  let i = 0;
  let line = 1;
  let depth = 0;
  let lineHasToken = false;
  const n = sql.length;

  const push = (type: TokenType, start: number, end: number, startLine: number, upper?: string, extra?: Partial<Token>) => {
    const value = sql.slice(start, end);
    tokens.push({ type, value, upper: upper ?? value, start, end, line: startLine, depth, ...extra });
    lineHasToken = true;
  };

  while (i < n) {
    const ch = sql[i] as string;

    if (ch === "\n") {
      line++;
      lineHasToken = false;
      i++;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\f" || ch === "\u00a0" || ch === "\ufeff") {
      i++;
      continue;
    }

    // -- line comment (also # in MySQL)
    if ((ch === "-" && sql[i + 1] === "-") || (dialect === "mysql" && ch === "#")) {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }

    // block comment, nested in T-SQL
    if (ch === "/" && sql[i + 1] === "*") {
      const startLine = line;
      let nest = 1;
      i += 2;
      while (i < n && nest > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*" && dialect === "tsql") {
          nest++;
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          nest--;
          i += 2;
        } else {
          if (sql[i] === "\n") line++;
          i++;
        }
      }
      if (nest > 0) unterminated.push({ kind: "comment", line: startLine });
      continue;
    }

    // strings: 'abc', N'abc', E'abc'
    const isNPrefix = (ch === "N" || ch === "n") && sql[i + 1] === "'";
    if (ch === "'" || isNPrefix) {
      const start = i;
      const startLine = line;
      i += isNPrefix ? 2 : 1;
      let closed = false;
      while (i < n) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        if (dialect === "mysql" && sql[i] === "\\") {
          i += 2;
          continue;
        }
        if (sql[i] === "\n") line++;
        i++;
      }
      if (!closed) unterminated.push({ kind: "string", line: startLine });
      push("string", start, i, startLine);
      continue;
    }

    // PostgreSQL dollar quoting
    if (ch === "$" && dialect === "postgresql") {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 64));
      if (m) {
        const tag = m[0];
        const startLine = line;
        const close = sql.indexOf(tag, i + tag.length);
        const end = close === -1 ? n : close + tag.length;
        if (close === -1) unterminated.push({ kind: "string", line: startLine });
        for (let k = i; k < end; k++) if (sql[k] === "\n") line++;
        push("string", i, end, startLine);
        i = end;
        continue;
      }
    }

    // quoted identifiers
    if (ch === "[" || ch === '"' || ch === "`") {
      if (ch === "[" && dialect !== "tsql" && dialect !== "sqlite") {
        push("punct", i, i + 1, line);
        i++;
        continue;
      }
      const close = ch === "[" ? "]" : ch;
      const start = i;
      const startLine = line;
      i++;
      let closed = false;
      while (i < n) {
        if (sql[i] === close) {
          if (sql[i + 1] === close) {
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        if (sql[i] === "\n") line++;
        i++;
      }
      if (!closed) unterminated.push({ kind: "identifier", line: startLine });
      const raw = sql.slice(start + 1, closed ? i - 1 : i);
      push("ident", start, i, startLine, raw.split(close + close).join(close));
      continue;
    }

    // variables / temp tables
    if (ch === "@") {
      const start = i;
      i++;
      if (sql[i] === "@") i++;
      while (i < n && WORD_PART.test(sql[i] as string)) i++;
      push("variable", start, i, line, sql.slice(start, i).toUpperCase());
      continue;
    }
    if (ch === "#" && dialect === "tsql") {
      const start = i;
      i++;
      if (sql[i] === "#") i++;
      while (i < n && WORD_PART.test(sql[i] as string)) i++;
      push("temp", start, i, line);
      continue;
    }

    // numbers
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(sql[i + 1] ?? ""))) {
      const start = i;
      if (ch === "0" && (sql[i + 1] === "x" || sql[i + 1] === "X")) {
        i += 2;
        while (i < n && /[0-9a-fA-F]/.test(sql[i] as string)) i++;
      } else {
        while (i < n && /[0-9]/.test(sql[i] as string)) i++;
        if (sql[i] === "." && /[0-9]/.test(sql[i + 1] ?? "")) {
          i++;
          while (i < n && /[0-9]/.test(sql[i] as string)) i++;
        }
        if ((sql[i] === "e" || sql[i] === "E") && /[0-9+-]/.test(sql[i + 1] ?? "")) {
          i += 2;
          while (i < n && /[0-9]/.test(sql[i] as string)) i++;
        }
      }
      push("number", start, i, line);
      continue;
    }

    // words
    if (WORD_START.test(ch)) {
      const start = i;
      i++;
      while (i < n && WORD_PART.test(sql[i] as string)) i++;
      const text = sql.slice(start, i);
      const upper = text.toUpperCase();

      // GO batch separator: alone on its line (optionally followed by a count)
      if (dialect === "tsql" && upper === "GO" && !lineHasToken) {
        let j = i;
        while (j < n && (sql[j] === " " || sql[j] === "\t")) j++;
        const countMatch = /^[0-9]+/.exec(sql.slice(j, j + 12));
        if (countMatch) j += countMatch[0].length;
        while (j < n && (sql[j] === " " || sql[j] === "\t" || sql[j] === "\r")) j++;
        const trailingComment = sql.startsWith("--", j);
        if (j >= n || sql[j] === "\n" || trailingComment || sql.startsWith(";", j)) {
          tokens.push({
            type: "go",
            value: text,
            upper,
            start,
            end: i,
            line,
            depth: 0,
            ...(countMatch ? { goCount: Number(countMatch[0]) } : {}),
          });
          lineHasToken = true;
          if (countMatch) i = j;
          continue;
        }
      }
      push("word", start, i, line, upper);
      continue;
    }

    // operators and punctuation
    if (ch === "(") {
      push("punct", i, i + 1, line);
      depth++;
      i++;
      continue;
    }
    if (ch === ")") {
      depth = Math.max(0, depth - 1);
      push("punct", i, i + 1, line);
      i++;
      continue;
    }
    if (ch === "," || ch === ";" || ch === ".") {
      push("punct", i, i + 1, line);
      i++;
      continue;
    }
    if (OPERATOR_CHARS.has(ch)) {
      const start = i;
      const two = sql.slice(i, i + 2);
      if (["<>", "<=", ">=", "!=", "!<", "!>", "||", "::", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^="].includes(two)) i += 2;
      else i++;
      push("op", start, i, line);
      continue;
    }

    push("punct", i, i + 1, line);
    i++;
  }

  return { tokens, unterminated };
}

/** Splits the token stream into GO-delimited batches. */
export function splitBatches(tokens: Token[]): { tokens: Token[]; repeat: number }[] {
  const batches: { tokens: Token[]; repeat: number }[] = [];
  let current: Token[] = [];
  for (const t of tokens) {
    if (t.type === "go") {
      if (current.length > 0) batches.push({ tokens: current, repeat: t.goCount ?? 1 });
      current = [];
    } else {
      current.push(t);
    }
  }
  if (current.length > 0) batches.push({ tokens: current, repeat: 1 });
  return batches;
}
