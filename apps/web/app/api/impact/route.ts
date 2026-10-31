import { NextResponse } from "next/server";
import { z } from "zod";
import { analyzeColumnImpact } from "@querypilot/database-core";
import { apiError, authenticate, internalError, isResponse } from "@/lib/api";
import { getObject, getSnapshot } from "@/lib/data/queries";

const querySchema = z.object({ objectId: z.uuid(), column: z.string().trim().min(1).max(200) });

/** Deterministic impact analysis for a column change (no AI involved). */
export async function GET(request: Request) {
  const ctx = await authenticate();
  if (isResponse(ctx)) return ctx;
  const sp = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse({ objectId: sp.get("objectId"), column: sp.get("column") });
  if (!parsed.success) return apiError(422, "validation_failed", "objectId and column are required.");
  try {
    const obj = await getObject(parsed.data.objectId);
    if (!obj || obj.object_type !== "table") return apiError(404, "not_found", "Table not found.");
    const snapshot = await getSnapshot(obj.version_id, true);
    const impact = analyzeColumnImpact(snapshot, obj.id, parsed.data.column);
    if (!impact) return apiError(404, "not_found", "Table not found.");
    return NextResponse.json({ impact });
  } catch (e) {
    return internalError(e, "impact");
  }
}
