import { Hono } from "hono"
import { McpServer } from "@modelcontextprotocol/server"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server"
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/server/validators/cf-worker"
import { registerTools } from "./tools"
import { ZeppClient } from "./zepp/client"
import { DEFAULT_TIMEZONE } from "./zepp/constants"
import { resolveTimezone } from "./lib/time"

interface Env {
  ZEPP_KV: KVNamespace
  ZEPP_EMAIL: string
  ZEPP_PASSWORD: string
  // IANA timezone used to interpret dates (default Europe/Madrid).
  ZEPP_TIMEZONE?: string
  // When set, /mcp requires the token (Bearer header, `?key=` or /mcp/<token>).
  MCP_AUTH_TOKEN?: string
}

function createServer(env: Env): McpServer {
  const server = new McpServer(
    { name: "zepp-mcp", version: "1.1.0" },
    { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() }
  )
  const client = new ZeppClient(
    env.ZEPP_KV,
    env.ZEPP_EMAIL,
    env.ZEPP_PASSWORD,
    resolveTimezone(env.ZEPP_TIMEZONE, DEFAULT_TIMEZONE)
  )
  registerTools(server, client)
  return server
}

function tokensMatch(given: string, expected: string): boolean {
  const enc = new TextEncoder()
  const a = enc.encode(given)
  const b = enc.encode(expected)
  if (a.byteLength !== b.byteLength) return false
  return crypto.subtle.timingSafeEqual(a, b)
}

// The token may come as a Bearer header, a `?key=` parameter or the path (/mcp/<token>).
function isAuthorized(req: Request, expected: string | undefined, pathKey?: string): boolean {
  if (pathKey !== undefined) return !!expected && tokensMatch(pathKey, expected)
  if (!expected) return true
  const header = req.headers.get("authorization") ?? ""
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : ""
  const key = new URL(req.url).searchParams.get("key") ?? ""
  return tokensMatch(bearer || key, expected)
}

const app = new Hono<{ Bindings: Env }>()

async function handleMcp(req: Request, env: Env, pathKey?: string): Promise<Response> {
  if (!isAuthorized(req, env.MCP_AUTH_TOKEN, pathKey)) {
    return Response.json({ error: "unauthorized" }, { status: 401 })
  }
  const server = createServer(env)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  })
  await server.connect(transport)
  return transport.handleRequest(req)
}

app.all("/mcp", (c) => handleMcp(c.req.raw, c.env))
app.all("/mcp/:key", (c) => handleMcp(c.req.raw, c.env, c.req.param("key")))

app.get("/", (c) => {
  return c.json({ name: "zepp-mcp", status: "running" })
})

export default app
