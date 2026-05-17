import "server-only";

import { z } from "zod";
import { listOpenTasks, getPublicTaskBySlug } from "@/lib/tasks";
import {
  findOpenTaskBySlug,
  gradeAndSaveSubmission,
} from "@/lib/submissions";
import type { McpAgent } from "@/lib/mcp/auth";

/**
 * Tool handlers — pure functions over (agent, args) → result.
 *
 * Registered with the MCP server in `./server.ts`. Kept separate so they're
 * easy to test in isolation without spinning up the MCP plumbing.
 *
 * Tool return convention:
 *   - On success: `{ ok: true, ...payload }`
 *   - On failure: `{ ok: false, error: string, ...details }`
 *
 * The MCP server.ts wrapper turns each return value into the SDK's
 * `{ content: [{ type: 'text', text: JSON.stringify(...) }] }` envelope.
 * Agents read the JSON and act on it.
 */

// ============================================================
// Zod input schemas (used by McpServer.registerTool)
// ============================================================

export const ListOpenTasksInput = {
  category: z
    .string()
    .optional()
    .describe(
      'Filter to a single category (e.g. "code"). Omit to list every category.'
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Max number of tasks to return. Default 20."),
};

export const GetTaskInput = {
  slug: z
    .string()
    .min(1)
    .max(120)
    .describe('Task slug, e.g. "agentic-ipv4-validator".'),
};

/**
 * Payload schema is grader-specific. We accept either a regex_roulette
 * payload (`{ regex }`) OR a rider_bench payload (`{ plan }`). The server
 * picks the right grader based on the task's grader kind; if the payload
 * doesn't match the task's grader, the response is a clean 400.
 */
const RegexPayload = z
  .object({
    regex: z
      .string()
      .min(1)
      .max(500)
      .describe(
        "Regex body (no leading/trailing slashes, no flags). For regex_roulette tasks."
      ),
  })
  .strict();

const PlanActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("move"),
    to: z.tuple([z.number().int().min(0), z.number().int().min(0)]),
  }),
  z.object({ action: z.literal("pickup"), order: z.string().min(1) }),
  z.object({ action: z.literal("deliver"), order: z.string().min(1) }),
  z.object({ action: z.literal("charge") }),
  z.object({ action: z.literal("wait") }),
]);

const PlanPayload = z
  .object({
    plan: z
      .array(PlanActionSchema)
      .min(1)
      .max(500)
      .describe(
        "Ordered list of actions. For rider_bench tasks. Each action: move/pickup/deliver/charge/wait."
      ),
  })
  .strict();

export const SubmitInput = {
  task_slug: z
    .string()
    .min(1)
    .max(120)
    .describe("Slug of the task you are submitting to."),
  payload: z
    .union([RegexPayload, PlanPayload])
    .describe(
      "Task-specific payload. Shape depends on the task's grader: regex_roulette uses { regex: '...' }; rider_bench uses { plan: [...] }."
    ),
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
    .optional()
    .describe(
      "Self-reported runtime metadata. Optional but recommended — surfaces on the leaderboard as 'submitted via X · powered by Y'."
    ),
};

// ============================================================
// Tool handlers
// ============================================================

export async function handleListOpenTasks(
  _agent: McpAgent,
  args: { category?: string; limit?: number }
) {
  const tasks = await listOpenTasks({
    category: args.category,
    limit: args.limit ?? 20,
  });
  return {
    ok: true as const,
    tasks: tasks.map((t) => ({
      slug: t.slug,
      title: t.title,
      category: t.category,
      mcp_only: t.mcp_only,
      deadline: t.deadline,
      // First paragraph only — agents can call get_task for the full prompt.
      summary: firstParagraph(t.description),
    })),
  };
}

export async function handleGetTask(
  _agent: McpAgent,
  args: { slug: string }
) {
  const task = await getPublicTaskBySlug(args.slug);
  if (!task) {
    return { ok: false as const, error: `Task '${args.slug}' not found.` };
  }
  if (task.status !== "open") {
    return {
      ok: false as const,
      error: `Task '${args.slug}' is ${task.status}, not open.`,
    };
  }
  const cfg = task.auto_grader_config as Record<string, unknown> & {
    kind?: string;
  };
  const kind = cfg.kind ?? "unknown";

  // Surface the full grader config — this is intentional. For
  // regex_roulette only the *public* test_cases are in `auto_grader_config`
  // (hidden cases live in task_hidden_data, untouched here). For
  // rider_bench the scenario is entirely public; agents NEED the full
  // scenario to plan.
  const submitFormat =
    kind === "regex_roulette"
      ? { payload: { regex: "string" } }
      : kind === "rider_bench"
      ? {
          payload: {
            plan: [
              { action: "move", to: ["x", "y"] },
              { action: "pickup", order: "id" },
              { action: "deliver", order: "id" },
              { action: "charge" },
              { action: "wait" },
            ],
          },
        }
      : null;

  return {
    ok: true as const,
    task: {
      slug: task.slug,
      title: task.title,
      category: task.category,
      mcp_only: task.mcp_only,
      deadline: task.deadline,
      prompt: task.description,
      grader: cfg,
      submit_format: submitFormat,
    },
  };
}

export async function handleSubmit(
  agent: McpAgent,
  args: {
    task_slug: string;
    payload: unknown;
    runtime?: Record<string, unknown>;
  }
) {
  const taskCheck = await findOpenTaskBySlug(args.task_slug, {
    authMethod: "mcp",
  });
  if (!taskCheck.ok) {
    return {
      ok: false as const,
      error: taskCheck.error,
      status: taskCheck.status,
    };
  }

  const result = await gradeAndSaveSubmission({
    taskSlug: args.task_slug,
    agentId: agent.id,
    payload: args.payload,
    runtime: args.runtime,
    source: "mcp",
  });

  if (!result.ok) {
    return {
      ok: false as const,
      error: result.error,
      reason: result.reason ?? null,
    };
  }

  return {
    ok: true as const,
    submission_id: result.submission_id,
    score: result.score,
    agent: { slug: agent.slug, name: agent.name },
    ...result.details,
  };
}

// ============================================================
// helpers
// ============================================================

function firstParagraph(text: string): string {
  const para = text.split(/\n\n/)[0] ?? text;
  return para.length > 220 ? para.slice(0, 217) + "..." : para;
}
