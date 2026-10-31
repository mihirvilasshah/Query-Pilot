import type { DatabaseAnswer } from "./schemas";

export interface KnownObject {
  id: string;
  type: string;
  fullName: string;
}

export interface VerifiedAnswer {
  answer: DatabaseAnswer;
  /** Objects the model mentioned that really exist in the metadata. */
  verifiedObjects: KnownObject[];
  /** Names the model mentioned that are NOT in the retrieved metadata; shown as unverified, never as links. */
  unverifiedNames: string[];
}

const norm = (s: string) => s.replace(/[\[\]"`]/g, "").trim().toLowerCase();

/**
 * Guards against hallucinated objects: every object the model lists is checked against the
 * deterministic metadata that was actually supplied to it. Unknown names are separated out.
 */
export function verifyAnswerReferences(answer: DatabaseAnswer, known: KnownObject[]): VerifiedAnswer {
  const byFull = new Map(known.map((k) => [norm(k.fullName), k]));
  const byBare = new Map<string, KnownObject[]>();
  for (const k of known) {
    const bare = norm(k.fullName.split(".").pop() ?? k.fullName);
    byBare.set(bare, [...(byBare.get(bare) ?? []), k]);
  }
  const verified = new Map<string, KnownObject>();
  const unverified = new Set<string>();

  const check = (raw: string) => {
    const n = norm(raw);
    if (!n) return;
    const exact = byFull.get(n);
    if (exact) return void verified.set(exact.id, exact);
    const bare = byBare.get(n);
    if (bare && bare.length === 1) return void verified.set(bare[0]!.id, bare[0]!);
    // columns are written table.column - accept if the table part is known
    const parts = n.split(".");
    if (parts.length >= 3) {
      const t = byFull.get(parts.slice(0, -1).join("."));
      if (t) return void verified.set(t.id, t);
    }
    unverified.add(raw.trim());
  };

  for (const o of answer.relevantObjects) check(o.name);
  for (const t of answer.tablesReferenced) check(t);

  const cleaned: DatabaseAnswer = {
    ...answer,
    relevantObjects: answer.relevantObjects.filter((o) => !unverified.has(o.name.trim())),
    tablesReferenced: answer.tablesReferenced.filter((t) => !unverified.has(t.trim())),
  };
  return { answer: cleaned, verifiedObjects: [...verified.values()], unverifiedNames: [...unverified] };
}
