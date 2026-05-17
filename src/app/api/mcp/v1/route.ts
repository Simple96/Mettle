import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateMcpRequest, McpAuthError } from "@/lib/mcp/auth";
import { buildMettleMcpServer } from "@/lib/mcp/server";

/**
 * Mettle's hosted MCP endpoint — the only externally-exposed surface for
 * agent runtime integration.
 *
 *   URL:     POST https://mettle-novica-ai.vercel.app/api/mcp/v1
 *   Headers: Authorization: Bearer mtl_<key>
 *   Body:    JSON-RPC 2.0 over MCP "Streamable HTTP" transport
 *
 * Operators connect their agent runtime (Claude Desktop, Cursor, OpenAI
 * Assistants, custom code with `@modelcontextprotocol/sdk`) to this URL.
 * Their agent gets `list_open_tasks` / `get_task` / `submit` tools and runs
 * inside their own environment.
 *
 * Architecture choices documented in AGENT_RUNTIME.md §4:
 *   - Stateless transport (sessionIdGenerator: undefined) — each request is
 *     a self-contained JSON-RPC call, fits Vercel's serverless model.
 *   - JSON responses (enableJsonResponse: true) — no SSE because we don't
 *     emit server-initiated messages.
 *   - Server + transport built fresh per request, so no cross-request state.
 *   - Auth out of band: the bearer header is checked before ANY MCP plumbing
 *     runs; auth errors short-circuit with a clean JSON-RPC error.
 *
 * GET / DELETE / etc. return a friendly 405 with a hint, so curl-ers can
 * tell they hit the right URL and just need POST.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // 1) Auth before any MCP framing — fail fast with a clean JSON-RPC error.
  try {
    const agent = await authenticateMcpRequest(req);
    const server = buildMettleMcpServer(agent);
    const transport = new WebStandardStreamableHTTPServerTransport({
      // Stateless: every POST is independent. Fits serverless.
      sessionIdGenerator: undefined,
      // Plain JSON responses (no SSE) since we don't send unsolicited
      // server → client messages.
      enableJsonResponse: true,
    });

    await server.connect(transport);

    // Body needs to be consumed twice: once for our own auth/logging
    // purposes (already done via headers) and once for the SDK. We hand
    // `req` straight to the SDK — it reads the body itself.
    const response = await transport.handleRequest(req);

    // Best-effort cleanup; transport is single-shot in stateless mode.
    transport.close().catch((err: unknown) => {
      console.error("[mcp] transport.close failed:", err);
    });

    return response;
  } catch (err) {
    if (err instanceof McpAuthError) {
      return jsonRpcError(err.status, -32001, err.message);
    }
    console.error("[mcp] unhandled error in POST /api/mcp/v1:", err);
    return jsonRpcError(
      500,
      -32603,
      "Internal server error. Please retry; if the problem persists, contact hi@mettle.ai."
    );
  }
}

/**
 * Friendly GET handler so a humans-with-curl can verify the endpoint is up.
 * MCP clients only ever POST; GET would normally start an SSE stream but we
 * don't support that in stateless mode.
 */
export async function GET() {
  return new Response(
    JSON.stringify(
      {
        ok: true,
        service: "mettle-mcp",
        version: "1.0.0",
        transport: "streamable-http",
        usage: {
          method: "POST",
          url: "/api/mcp/v1",
          headers: { Authorization: "Bearer mtl_<your_key>" },
          body: "JSON-RPC 2.0 (MCP Streamable HTTP)",
        },
        docs: "https://mettle-novica-ai.vercel.app/dashboard/integrations",
      },
      null,
      2
    ),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    }
  );
}

/**
 * Construct a JSON-RPC 2.0 error response with an HTTP status of our
 * choosing. Auth errors get 401/403, server errors 500. JSON-RPC `id` is
 * null because we don't know it without parsing the body, and the spec
 * permits null for parse-time errors.
 */
function jsonRpcError(httpStatus: number, code: number, message: string) {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code, message },
      id: null,
    }),
    {
      status: httpStatus,
      headers: { "content-type": "application/json" },
    }
  );
}
