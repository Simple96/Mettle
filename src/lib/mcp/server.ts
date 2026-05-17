import "server-only";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpAgent } from "@/lib/mcp/auth";
import {
  ListOpenTasksInput,
  GetTaskInput,
  SubmitInput,
  handleListOpenTasks,
  handleGetTask,
  handleSubmit,
} from "@/lib/mcp/tools";

/**
 * Build a fresh `McpServer` per request with all Mettle tools registered
 * against the given (already-authenticated) agent. Per-request construction
 * matches the stateless transport: every call carries its own auth, every
 * call gets its own server instance, no shared state to leak between
 * operators.
 *
 * The tools are *thin wrappers* — they delegate to handlers in `./tools.ts`
 * and only deal with the SDK envelope shape:
 *
 *   { content: [{ type: "text", text: <JSON string> }] }
 *
 * Agents read the JSON. Errors are returned as JSON with `ok: false` rather
 * than thrown — this keeps the tool surface predictable from the agent's
 * point of view and lets them recover gracefully.
 */
export function buildMettleMcpServer(agent: McpAgent): McpServer {
  const server = new McpServer(
    { name: "mettle", version: "1.0.0" },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.registerTool(
    "list_open_tasks",
    {
      title: "List open Arena tasks",
      description:
        "Return all currently open Mettle Arena tasks you can submit to. Use this to discover what's available before fetching task details.",
      inputSchema: ListOpenTasksInput,
    },
    async (args) => {
      const result = await handleListOpenTasks(agent, args);
      return toolJson(result);
    }
  );

  server.registerTool(
    "get_task",
    {
      title: "Get task details",
      description:
        "Fetch full details of a single task by slug — including the prompt, public sample test cases, and submission format. Public samples are a subset; your real score is computed on a larger hidden set.",
      inputSchema: GetTaskInput,
    },
    async (args) => {
      const result = await handleGetTask(agent, args);
      return toolJson(result);
    }
  );

  server.registerTool(
    "submit",
    {
      title: "Submit a solution",
      description:
        "Submit your solution to a task. Grading is synchronous: the response contains your score, public test case results, and a submission_id you can reference later. You can re-submit; the latest submission overwrites the previous one for this agent on this task.",
      inputSchema: SubmitInput,
    },
    async (args) => {
      const result = await handleSubmit(agent, args);
      return toolJson(result);
    }
  );

  return server;
}

/**
 * Wrap any JSON-serializable value into the MCP tool result envelope.
 * Marks the entire response as `isError` when the wrapped value has
 * `ok: false`, so MCP-aware agents can short-circuit cleanly.
 */
function toolJson(value: unknown) {
  const isError =
    typeof value === "object" && value !== null && (value as { ok?: boolean }).ok === false;
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
    isError,
  };
}
