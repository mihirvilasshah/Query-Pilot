import { describe, expect, it } from "vitest";
import { passwordSchema, projectInputSchema, sanitizeFileName, sniffFile, uploadRequestSchema, MAX_UPLOAD_BYTES } from "../src";

const bytes = (...b: number[]) => Uint8Array.from(b);
const text = (s: string) => new TextEncoder().encode(s);

describe("sniffFile", () => {
  it("accepts ZIP-based dacpac and text sql", () => {
    expect(sniffFile("a.dacpac", bytes(0x50, 0x4b, 3, 4, 0)).kind).toBe("dacpac");
    expect(sniffFile("a.SQL", text("CREATE TABLE t (id int)")).kind).toBe("sql");
  });
  it("does not trust extensions", () => {
    expect(sniffFile("a.dacpac", text("CREATE TABLE")).ok).toBe(false);
    expect(sniffFile("a.sql", bytes(0x50, 0x4b, 3, 4)).ok).toBe(false);
    expect(sniffFile("a.sql", bytes(0x4d, 0x5a, 0x90, 0)).ok).toBe(false);
    expect(sniffFile("a.sql", bytes(0x53, 0x45, 0, 0x4c)).ok).toBe(false);
    expect(sniffFile("a.exe", text("x")).ok).toBe(false);
  });
  it("accepts UTF-16 sql with BOM and rejects empty files", () => {
    expect(sniffFile("a.sql", bytes(0xff, 0xfe, 0x53, 0x00, 0x45, 0x00)).ok).toBe(true);
    expect(sniffFile("a.sql", bytes()).ok).toBe(false);
  });
});

describe("validation schemas", () => {
  it("sanitises file names (no traversal)", () => {
    expect(sanitizeFileName("..\\..\\evil/../my db.dacpac")).toBe("my db.dacpac");
    expect(sanitizeFileName("../../")).toBe("file");
    expect(sanitizeFileName("a\u0000b.sql")).toBe("a_b.sql");
  });
  it("enforces upload size and password strength", () => {
    expect(uploadRequestSchema.safeParse({ projectId: crypto.randomUUID(), fileName: "a.sql", fileSize: MAX_UPLOAD_BYTES + 1 }).success).toBe(false);
    expect(passwordSchema.safeParse("short").success).toBe(false);
    expect(passwordSchema.safeParse("Longenough1").success).toBe(true);
  });
  it("normalises project input", () => {
    const r = projectInputSchema.parse({ name: "  Hospital  ", description: "", platform: "azure_sql_managed_instance" });
    expect(r).toEqual({ name: "Hospital", description: null, platform: "azure_sql_managed_instance" });
  });
});
