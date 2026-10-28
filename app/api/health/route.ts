import { NextResponse } from "next/server";
import { createPublicClient } from "@/lib/supabase/public";

export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  const { error } = await createPublicClient()
    .from("site_settings")
    .select("key")
    .limit(1);

  if (error) {
    return NextResponse.json(
      { ok: false, database: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    { ok: true, database: "connected", responseTimeMs: Date.now() - startedAt },
    { headers: { "Cache-Control": "no-store" } },
  );
}
