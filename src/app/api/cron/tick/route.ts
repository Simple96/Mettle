import { NextResponse } from "next/server";
import { tick } from "@/lib/queue/worker";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const started = Date.now();
  try {
    const result = await tick();
    return NextResponse.json({
      ok: true,
      ms: Date.now() - started,
      ...result,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: msg, ms: Date.now() - started },
      { status: 500 }
    );
  }
}
