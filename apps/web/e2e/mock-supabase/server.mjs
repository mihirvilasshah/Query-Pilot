// Minimal in-memory stand-in for Supabase (GoTrue + PostgREST + Storage), enough to run the whole QueryPilot UI
// without Docker or a real project. Used by the Playwright e2e suite and for offline demos:
//   node e2e/mock-supabase/server.mjs            (listens on :54321)
// It implements just the query features QueryPilot uses. It is NOT a security boundary and has no RLS.
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { seed, USER, V1 } from "./seed.mjs";

const PORT = Number(process.env.MOCK_SUPABASE_PORT ?? 54321);
let db = seed();
const files = new Map(); // "bucket/path" -> Buffer
const TOKEN_TTL = 60 * 60 * 24 * 365;

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function makeSession() {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + TOKEN_TTL;
  const user = { id: USER.id, aud: "authenticated", role: "authenticated", email: USER.email, email_confirmed_at: new Date().toISOString(), app_metadata: { provider: "email" }, user_metadata: { display_name: USER.displayName }, created_at: new Date().toISOString() };
  const access_token = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: USER.id, email: USER.email, role: "authenticated", aud: "authenticated", iat, exp })}.mock-signature`;
  return { access_token, token_type: "bearer", expires_in: TOKEN_TTL, expires_at: exp, refresh_token: "mock-refresh-token", user };
}
const isAuthed = (req) => (req.headers.authorization ?? "").includes("mock-signature");

function cors(res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "authorization, apikey, x-client-info, content-type, x-upsert, range, range-unit, prefer, accept, accept-profile, content-profile, cache-control, x-supabase-api-version");
  res.setHeader("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS");
  res.setHeader("access-control-expose-headers", "content-range");
}
function send(res, status, body, headers = {}) {
  cors(res);
  const json = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(json);
}
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

// ---------------------------------------------------------------- PostgREST-ish querying
const RESERVED = new Set(["select", "order", "limit", "offset", "or", "and", "on_conflict", "columns"]);
const str = (v) => (v === null || v === undefined ? null : Array.isArray(v) ? v : String(v));

function matches(row, col, expr) {
  let negate = false;
  let [op, ...rest] = [expr.slice(0, expr.indexOf(".")), expr.slice(expr.indexOf(".") + 1)];
  if (op === "not") { negate = true; [op, ...rest] = [rest.join(".").slice(0, rest.join(".").indexOf(".")), rest.join(".").slice(rest.join(".").indexOf(".") + 1)]; }
  const val = rest.join(".");
  const cell = row[col];
  let ok;
  switch (op) {
    case "eq": ok = str(cell) === val; break;
    case "neq": ok = str(cell) !== val; break;
    case "gt": ok = String(cell) > val; break;
    case "gte": ok = String(cell) >= val; break;
    case "lt": ok = String(cell) < val; break;
    case "lte": ok = String(cell) <= val; break;
    case "is": ok = val === "null" ? cell === null || cell === undefined : String(cell) === val; break;
    case "in": ok = val.replace(/^\(|\)$/g, "").split(",").map((s) => s.replace(/^"|"$/g, "")).includes(String(cell)); break;
    case "like":
    case "ilike": {
      const re = new RegExp(`^${val.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "%").replace(/%/g, ".*")}$`, "i");
      ok = re.test(String(cell ?? ""));
      break;
    }
    case "cs": { const want = val.replace(/^\{|\}$/g, "").split(",").filter(Boolean); ok = Array.isArray(cell) && want.every((w) => cell.includes(w)); break; }
    default: ok = true;
  }
  return negate ? !ok : ok;
}

function splitTop(s) {
  const out = []; let depth = 0; let cur = "";
  for (const ch of s) { if (ch === "(") depth++; if (ch === ")") depth--; if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch; }
  if (cur) out.push(cur);
  return out;
}

function query(table, params, req) {
  let rows = [...(db[table] ?? [])];
  for (const [k, v] of params) {
    if (RESERVED.has(k)) continue;
    rows = rows.filter((r) => matches(r, k, v));
  }
  const or = params.get("or");
  if (or) {
    const parts = splitTop(or.replace(/^\(|\)$/g, ""));
    rows = rows.filter((r) => parts.some((p) => { const i = p.indexOf("."); return matches(r, p.slice(0, i), p.slice(i + 1)); }));
  }
  const order = params.get("order");
  if (order) {
    const keys = order.split(",").map((o) => { const [c, dir] = o.split("."); return [c, dir === "desc" ? -1 : 1]; });
    rows.sort((a, b) => { for (const [c, d] of keys) { const x = a[c], y = b[c]; if (x === y) continue; if (x == null) return 1; if (y == null) return -1; return (x < y ? -1 : 1) * d; } return 0; });
  }
  const total = rows.length;
  const range = req.headers.range;
  let offset = Number(params.get("offset") ?? 0);
  let limit = params.get("limit") ? Number(params.get("limit")) : Infinity;
  if (range && /^\d+-\d+$/.test(range)) { const [a, b] = range.split("-").map(Number); offset = a; limit = b - a + 1; }
  rows = rows.slice(offset, offset + limit);
  const select = params.get("select");
  if (select && select !== "*" && !select.includes("(")) {
    const cols = select.split(",").map((s) => s.trim());
    rows = rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
  }
  return { rows, total, offset };
}

const DEFAULTS = {
  database_projects: () => ({ platform: "sqlserver", description: null }),
  sql_scripts: () => ({ tags: [], is_favorite: false, category: null, description: null }),
  user_preferences: () => ({ theme: "system", default_dialect: "tsql", ai_external_consent: false }),
};
const UNIQUE = { database_projects: ["owner_id", "name"] };

function cascadeDelete(table, removed) {
  if (table === "database_projects") {
    const ids = new Set(removed.map((r) => r.id));
    const versions = db.database_versions.filter((v) => ids.has(v.project_id));
    db.database_versions = db.database_versions.filter((v) => !ids.has(v.project_id));
    const vids = new Set(versions.map((v) => v.id));
    for (const t of ["database_import_jobs", "database_objects", "database_columns", "database_relationships", "database_indexes", "database_constraints", "database_dependencies"]) db[t] = db[t].filter((r) => !vids.has(r.version_id));
  }
  if (table === "sql_scripts") db.sql_script_versions = db.sql_script_versions.filter((v) => !removed.some((r) => r.id === v.script_id));
}

function rest(req, res, url, bodyBuf) {
  const parts = url.pathname.replace("/rest/v1/", "").split("/");
  const name = parts[0];
  const params = url.searchParams;
  const wantsObject = (req.headers.accept ?? "").includes("vnd.pgrst.object");
  const prefer = req.headers.prefer ?? "";

  if (name === "rpc") return rpc(parts[1], bodyBuf.length ? JSON.parse(bodyBuf.toString()) : {}, res);
  if (!(name in db)) return send(res, 404, { code: "42P01", message: `relation "${name}" does not exist` });

  const respond = (rows, status = 200, extra = {}) => {
    if (wantsObject) return rows.length === 1 ? send(res, status, rows[0], extra) : send(res, 406, { code: "PGRST116", details: `The result contains ${rows.length} rows`, hint: null, message: "JSON object requested, multiple (or no) rows returned" });
    return send(res, status, rows, extra);
  };

  if (req.method === "GET" || req.method === "HEAD") {
    const { rows, total, offset } = query(name, params, req);
    const cr = { "content-range": rows.length ? `${offset}-${offset + rows.length - 1}/${total}` : `*/${total}` };
    if (req.method === "HEAD") { cors(res); res.writeHead(200, { ...cr }); return res.end(); }
    return respond(rows, 200, prefer.includes("count") ? cr : {});
  }
  const body = bodyBuf.length ? JSON.parse(bodyBuf.toString()) : {};
  if (req.method === "POST") {
    const incoming = Array.isArray(body) ? body : [body];
    const created = [];
    for (const raw of incoming) {
      const row = { id: randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...(DEFAULTS[name]?.() ?? {}), ...raw };
      const uq = UNIQUE[name];
      if (uq && db[name].some((r) => uq.every((c) => r[c] === row[c]))) return send(res, 409, { code: "23505", message: "duplicate key value violates unique constraint", details: null, hint: null });
      db[name].push(row);
      created.push(row);
    }
    return prefer.includes("return=representation") ? respond(created, 201) : send(res, 201, undefined);
  }
  if (req.method === "PATCH") {
    const { rows } = query(name, params, req);
    for (const r of rows) Object.assign(db[name].find((x) => x.id === r.id) ?? {}, body, { updated_at: new Date().toISOString() });
    const fresh = rows.map((r) => db[name].find((x) => x.id === r.id));
    return prefer.includes("return=representation") ? respond(fresh) : send(res, 204, undefined);
  }
  if (req.method === "DELETE") {
    const { rows } = query(name, params, req);
    const ids = new Set(rows.map((r) => r.id));
    db[name] = db[name].filter((r) => !ids.has(r.id));
    cascadeDelete(name, rows);
    return prefer.includes("return=representation") ? respond(rows) : send(res, 204, undefined);
  }
  return send(res, 405, { message: "unsupported" });
}

function rpc(fn, args, res) {
  if (fn === "check_rate_limit") return send(res, 200, true);
  if (fn === "dashboard_stats") {
    const latest = new Map();
    for (const v of db.database_versions.filter((x) => x.status.startsWith("ready")).sort((a, b) => a.version_number - b.version_number)) latest.set(v.project_id, v.id);
    const ids = new Set(latest.values());
    const inLatest = (t) => db.database_objects.filter((o) => o.object_type === t && ids.has(o.version_id)).length;
    return send(res, 200, { projects: db.database_projects.length, schema_versions: db.database_versions.filter((v) => v.status.startsWith("ready")).length, tables: inLatest("table"), procedures: inLatest("procedure"), scripts: db.sql_scripts.length, analyses: db.sql_analyses.length, ai_interactions: db.ai_requests.filter((r) => r.status === "success").length });
  }
  if (fn === "create_schema_version_and_job") {
    const n = Math.max(0, ...db.database_versions.filter((v) => v.project_id === args.p_project_id).map((v) => v.version_number)) + 1;
    const version = { id: randomUUID(), owner_id: USER.id, project_id: args.p_project_id, version_number: n, label: args.p_label || null, source_type: args.p_source_type, source_file_name: args.p_file_name, storage_path: args.p_storage_path, database_name: null, status: "pending", summary: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    const job = { id: randomUUID(), owner_id: USER.id, project_id: args.p_project_id, version_id: version.id, status: "pending", stage: null, progress: 0, file_name: args.p_file_name, file_size: args.p_file_size, file_type: args.p_source_type, storage_path: args.p_storage_path, error_code: null, error_message: null, warnings: [], attempts: 0, max_attempts: 3, started_at: null, finished_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    db.database_versions.push(version);
    db.database_import_jobs.push(job);
    // simulated worker: validating -> processing -> completed (or failed for files named *fail*)
    const set = (patch) => Object.assign(job, patch, { updated_at: new Date().toISOString() });
    setTimeout(() => set({ status: "validating", stage: "Validating file", progress: 10 }), 500);
    setTimeout(() => set({ status: "processing", stage: "Extracting objects", progress: 55 }), 1200);
    setTimeout(() => {
      if (/fail/i.test(args.p_file_name)) {
        set({ status: "failed", stage: "Failed", error_code: "PARSE_ERROR", error_message: `${args.p_file_name}: syntax error near line 3.` });
        version.status = "failed";
      } else {
        set({ status: "completed", stage: "Completed", progress: 100, finished_at: new Date().toISOString() });
        version.status = "ready";
        version.summary = db.database_versions.find((v) => v.id === V1)?.summary ?? {};
      }
    }, 2200);
    return send(res, 200, [{ version_id: version.id, job_id: job.id, version_number: n }]);
  }
  if (fn === "retry_import_job") {
    const job = db.database_import_jobs.find((j) => j.id === args.p_job_id);
    if (!job) return send(res, 400, { message: "not found" });
    Object.assign(job, { status: "pending", progress: 0, error_message: null, error_code: null });
    return send(res, 200, null);
  }
  return send(res, 404, { message: `unknown rpc ${fn}` });
}

// ---------------------------------------------------------------- storage
function extractMultipart(buf, contentType) {
  const m = /boundary=(.+)$/i.exec(contentType ?? "");
  if (!m) return buf;
  const boundary = Buffer.from(`--${m[1]}`);
  let start = 0; let best = null;
  for (;;) {
    const i = buf.indexOf(boundary, start);
    if (i === -1) break;
    const next = buf.indexOf(boundary, i + boundary.length);
    if (next === -1) break;
    const part = buf.subarray(i + boundary.length, next);
    const headEnd = part.indexOf("\r\n\r\n");
    if (headEnd !== -1) {
      const head = part.subarray(0, headEnd).toString();
      const content = part.subarray(headEnd + 4, part.length - 2);
      if (/filename=/i.test(head) || (!best && content.length)) best = content;
    }
    start = next;
  }
  return best ?? buf;
}

async function storage(req, res, url, bodyBuf) {
  const p = decodeURIComponent(url.pathname.replace("/storage/v1", ""));
  const signUpload = /^\/object\/upload\/sign\/(.+)$/.exec(p);
  if (signUpload && req.method === "POST") return send(res, 200, { url: `/object/upload/sign/${signUpload[1]}?token=${randomUUID()}` });
  if (signUpload && req.method === "PUT") { files.set(signUpload[1], Buffer.from(extractMultipart(bodyBuf, req.headers["content-type"]))); return send(res, 200, { Key: signUpload[1] }); }
  const sign = /^\/object\/sign\/(.+)$/.exec(p);
  if (sign && req.method === "POST") { if (!files.has(sign[1])) return send(res, 404, { statusCode: "404", error: "not_found", message: "Object not found" }); return send(res, 200, { signedURL: `/object/sign/${sign[1]}?token=${randomUUID()}` }); }
  if (sign && req.method === "GET") {
    const f = files.get(sign[1]);
    if (!f) return send(res, 404, { message: "Object not found" });
    cors(res);
    const m = /bytes=(\d+)-(\d+)?/.exec(req.headers.range ?? "");
    if (m) { const a = Number(m[1]); const b = Math.min(Number(m[2] ?? f.length - 1), f.length - 1); res.writeHead(206, { "content-range": `bytes ${a}-${b}/${f.length}`, "content-length": b - a + 1 }); return res.end(f.subarray(a, b + 1)); }
    res.writeHead(200, { "content-length": f.length }); return res.end(f);
  }
  if (/^\/object\/[^/]+$/.test(p) && req.method === "DELETE") { for (const k of JSON.parse(bodyBuf.toString() || "{}").prefixes ?? []) files.delete(`${p.split("/")[2]}/${k}`); return send(res, 200, []); }
  return send(res, 404, { message: "unsupported storage route" });
}

// ---------------------------------------------------------------- auth
function auth(req, res, url, bodyBuf) {
  const path = url.pathname.replace("/auth/v1", "");
  const body = bodyBuf.length ? JSON.parse(bodyBuf.toString()) : {};
  if (path === "/token") {
    if (url.searchParams.get("grant_type") === "refresh_token") return send(res, 200, makeSession());
    if (body.email === USER.email && body.password === USER.password) return send(res, 200, makeSession());
    return send(res, 400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials", error: "invalid_grant", error_description: "Invalid login credentials" });
  }
  if (path === "/user" && req.method === "GET") return isAuthed(req) ? send(res, 200, makeSession().user) : send(res, 401, { code: 401, msg: "invalid JWT" });
  if (path === "/user" && req.method === "PUT") return isAuthed(req) ? send(res, 200, makeSession().user) : send(res, 401, { msg: "invalid JWT" });
  if (path === "/logout") { cors(res); res.writeHead(204); return res.end(); }
  if (path === "/signup") return send(res, 200, { id: randomUUID(), aud: "authenticated", role: "", email: body.email, created_at: new Date().toISOString(), app_metadata: {}, user_metadata: body.data ?? {} });
  if (path === "/recover") return send(res, 200, {});
  return send(res, 404, { msg: "unsupported auth route" });
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "OPTIONS") { cors(res); res.writeHead(204); return res.end(); }
    if (url.pathname === "/__reset") { db = seed(); files.clear(); return send(res, 200, { ok: true }); }
    if (url.pathname === "/__state") return send(res, 200, { counts: Object.fromEntries(Object.entries(db).map(([k, v]) => [k, v.length])) });
    const body = await readBody(req);
    if (url.pathname.startsWith("/auth/v1/")) return auth(req, res, url, body);
    if (url.pathname.startsWith("/rest/v1/")) { if (!isAuthed(req)) return send(res, 401, { message: "JWT required", code: "PGRST301" }); return rest(req, res, url, body); }
    if (url.pathname.startsWith("/storage/v1/")) return await storage(req, res, url, body);
    return send(res, 404, { message: "not found" });
  } catch (e) {
    console.error("[mock-supabase]", e);
    send(res, 500, { message: String(e) });
  }
});
server.listen(PORT, "127.0.0.1", () => console.log(`mock supabase listening on http://127.0.0.1:${PORT}`));
