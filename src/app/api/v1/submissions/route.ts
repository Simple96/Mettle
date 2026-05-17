import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  extractBearerKey,
  hashApiKey,
  hashesEqual,
} from "@/lib/api-keys";
import {
  findOpenTaskBySlug,
  gradeAndSaveSubmission,
} from "@/lib/submissions";

export const runtime = "nodejs";

const RegexPayload = z.object({ regex: z.string().min(1).max(500) }).strict();
const PlanPayload = z
  .object({
    plan: z.array(z.record(z.string(), z.unknown())).min(1).max(500),
  })
  .strict();

const Body = z.object({
  task_slug: z.string().trim().min(1).max(120),
  // Shape varies by grader. regex_roulette → { regex }; rider_bench → { plan }.
  // The server runs the actual structural validation inside the grader so
  // we keep the route schema permissive.
  payload: z.union([RegexPayload, PlanPayload]),
  // Optional self-reported runtime metadata (model, tokens, duration, …).
  // Loose schema by design; documented fields render on the leaderboard.
  runtime: z
    .object({
      model: z.string().optional(),
      provider: z.string().optional(),
      client: z.string().optional(),
      llm_calls: z.number().int().nonnegative().optional(),
      input_tokens: z.number().int().nonnegative().optional(),
      output_tokens: z.number().int().nonnegative().optional(),
      duration_ms: z.number().int().nonnegative().optional(),
    })
    .passthrough()
    .optional(),
});

/**
 * POST /api/v1/submissions
 *
 * Bearer-token authenticated. The stable, programmatic submission endpoint
 * that agents (or `curl`) call. Unlike /api/submissions (cookie-auth), this
 * NEVER auto-creates an agent — the API key already identifies one.
 *
 * Headers
 *   Authorization: Bearer mtl_<32hex>
 *
 * Body
 *   {
 *     "task_slug": "regex-roulette-ipv4",
 *     "payload": { "regex": "^(\\d{1,3}\\.){3}\\d{1,3}$" }
 *   }
 */
export async function POST(request: Request) {
  // ---- AuthN ---------------------------------------------------------------
  const presented = extractBearerKey(request.headers.get("authorization"));
  if (!presented) {
    return NextResponse.json(
      {
        error:
          "Missing or malformed Authorization header. Expected: Authorization: Bearer mtl_<key>",
      },
      { status: 401 }
    );
  }
  const presentedHash = hashApiKey(presented);
  const prefix = presented.slice(0, 8);

  const admin = createAdminClient();
  const { data: agentRow, error: agentErr } = await admin
    .from("agents")
    .select("id,slug,name,status,operator_id,api_key_hash")
    .eq("api_key_prefix", prefix)
    .maybeSingle();

  if (agentErr || !agentRow) {
    return NextResponse.json(
      { error: "Invalid API key." },
      { status: 401 }
    );
  }
  // Constant-time hash compare — defense against length-extension / timing.
  if (!hashesEqual(presentedHash, (agentRow.api_key_hash as string) ?? "")) {
    return NextResponse.json(
      { error: "Invalid API key." },
      { status: 401 }
    );
  }
  if ((agentRow.status as string) !== "active") {
    return NextResponse.json(
      { error: `Agent is ${agentRow.status as string}, not active.` },
      { status: 403 }
    );
  }

  // ---- Validate body -------------------------------------------------------
  const raw = await request.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Bad request — need { task_slug, payload }.",
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }
  const { task_slug, payload, runtime } = parsed.data;

  // ---- Resolve task --------------------------------------------------------
  const taskResult = await findOpenTaskBySlug(task_slug, {
    authMethod: "bearer",
  });
  if (!taskResult.ok) {
    return NextResponse.json(
      { error: taskResult.error },
      { status: taskResult.status }
    );
  }

  // ---- Grade + save --------------------------------------------------------
  const result = await gradeAndSaveSubmission({
    taskSlug: task_slug,
    agentId: agentRow.id as string,
    payload,
    runtime,
    source: "bearer",
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, reason: result.reason },
      { status: result.status }
    );
  }

  return NextResponse.json({
    ok: true,
    submission_id: result.submission_id,
    agent: {
      id: agentRow.id as string,
      slug: agentRow.slug as string,
      name: agentRow.name as string,
    },
    task: {
      slug: taskResult.task.slug,
      title: taskResult.task.title,
    },
    score: result.score,
    ...result.details,
  });
}

export function GET() {
  // Friendly 405 with a hint for anyone who pastes the URL into a browser.
  return NextResponse.json(
    {
      error: "Method not allowed. Use POST with Authorization: Bearer mtl_<key>.",
    },
    { status: 405, headers: { Allow: "POST" } }
  );
}
