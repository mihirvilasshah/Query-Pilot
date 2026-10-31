import { afterEach, describe, expect, it, vi } from "vitest";
import { decryptSecret, encryptSecret, isEncryptionConfigured, keyHint } from "@/lib/crypto";
import { fieldErrors, safeNext } from "@/lib/redirect";
import { apiError, parseBody } from "@/lib/api";
import { formatBytes, formatColumnType, fullName, timeAgo } from "@/lib/format";
import { objectHref } from "@/lib/object-links";
import { reconstructCreateTable } from "@/lib/reconstruct";
import { z } from "zod";

afterEach(() => vi.unstubAllEnvs());

describe("safeNext (open redirect protection)", () => {
  it("allows only same-site relative paths", () => {
    expect(safeNext("/projects?x=1")).toBe("/projects?x=1");
    expect(safeNext("//evil.com")).toBe("/dashboard");
    expect(safeNext("https://evil.com")).toBe("/dashboard");
    expect(safeNext("/\\evil.com")).toBe("/dashboard");
    expect(safeNext(null)).toBe("/dashboard");
    expect(safeNext("javascript:alert(1)", "/x")).toBe("/x");
  });
  it("keeps the first error per field", () => {
    expect(fieldErrors([{ path: ["a"], message: "one" }, { path: ["a"], message: "two" }, { path: [], message: "form" }])).toEqual({ a: "one", form: "form" });
  });
});

describe("credential encryption (AES-256-GCM)", () => {
  const key = Buffer.alloc(32, 7).toString("base64");

  it("is disabled without a valid key", () => {
    vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", "");
    expect(isEncryptionConfigured()).toBe(false);
    expect(() => encryptSecret("x")).toThrow();
    vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", Buffer.alloc(16).toString("base64"));
    expect(isEncryptionConfigured()).toBe(false);
  });

  it("round-trips, never stores plaintext and uses a fresh IV", () => {
    vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", key);
    const a = encryptSecret("sk-or-super-secret");
    const b = encryptSecret("sk-or-super-secret");
    expect(JSON.stringify(a)).not.toContain("super-secret");
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(decryptSecret(a)).toBe("sk-or-super-secret");
  });

  it("detects tampering and wrong keys", () => {
    vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", key);
    const enc = encryptSecret("secret");
    const flipped = Buffer.from(enc.ciphertext, "base64");
    flipped[0] = flipped[0]! ^ 1;
    expect(() => decryptSecret({ ...enc, ciphertext: flipped.toString("base64") })).toThrow();
    vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));
    expect(() => decryptSecret(enc)).toThrow();
  });

  it("only exposes the last four characters as a hint", () => {
    expect(keyHint("abcdefghijkl")).toBe("…ijkl");
  });
});

describe("api helpers", () => {
  it("returns a structured error body", async () => {
    const res = apiError(422, "validation_failed", "bad");
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: { code: "validation_failed", message: "bad" } });
  });

  it("rejects malformed JSON and invalid bodies without leaking details", async () => {
    const schema = z.object({ n: z.number() });
    const bad = await parseBody(new Request("http://x", { method: "POST", body: "{nope" }), schema);
    expect(bad instanceof Response && bad.status).toBe(400);
    const invalid = await parseBody(new Request("http://x", { method: "POST", body: JSON.stringify({ n: "x" }) }), schema);
    expect(invalid instanceof Response && invalid.status).toBe(422);
    const ok = await parseBody(new Request("http://x", { method: "POST", body: JSON.stringify({ n: 3 }) }), schema);
    expect(ok).toEqual({ n: 3 });
  });
});

describe("formatting helpers", () => {
  it("formats bytes, names and types", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(fullName({ schema_name: "dbo", name: "T" })).toBe("dbo.T");
    expect(fullName({ schema_name: "", name: "T" })).toBe("T");
    expect(formatColumnType({ data_type: "NVARCHAR", max_length: -1, numeric_precision: null, numeric_scale: null })).toBe("nvarchar(max)");
    expect(formatColumnType({ data_type: "decimal", max_length: null, numeric_precision: 18, numeric_scale: 2 })).toBe("decimal(18,2)");
    expect(timeAgo(null)).toBe("never");
    expect(timeAgo(new Date().toISOString())).toBe("just now");
  });

  it("builds object links", () => {
    expect(objectHref("table", "abc")).toBe("/database-intelligence/tables/abc");
    expect(objectHref("trigger", "abc", "trg x")).toBe("/database-intelligence/triggers?q=trg%20x");
  });

  it("labels reconstructed DDL as built from metadata", () => {
    const sql = reconstructCreateTable("dbo", "T", [
      { id: "1", object_id: "o", name: "Id", ordinal: 1, data_type: "int", max_length: null, numeric_precision: null, numeric_scale: null, is_nullable: false, default_value: null, is_identity: true, is_primary_key: true, is_computed: false, computed_expression: null },
    ]);
    expect(sql).toContain("CREATE TABLE [dbo].[T]");
    expect(sql).toContain("[Id] int IDENTITY NOT NULL");
    expect(sql).toContain("PRIMARY KEY ([Id])");
  });
});
