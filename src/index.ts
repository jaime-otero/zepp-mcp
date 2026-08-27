import { Hono } from "hono"
import { McpServer } from "@modelcontextprotocol/server"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server"
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/server/validators/cf-worker"
import { registerTools } from "./tools"
import { ZeppClient } from "./zepp/client"

interface Env {
  ZEPP_KV: KVNamespace
  ZEPP_EMAIL: string
  ZEPP_PASSWORD: string
}

function createServer(env: Env): McpServer {
  const server = new McpServer(
    { name: "zepp-mcp", version: "1.0.0" },
    { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() }
  )
  const client = new ZeppClient(env.ZEPP_KV, env.ZEPP_EMAIL, env.ZEPP_PASSWORD)
  registerTools(server, client)
  return server
}

const app = new Hono<{ Bindings: Env }>()

app.all("/mcp", async (c) => {
  const server = createServer(c.env)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  })
  await server.connect(transport)
  return transport.handleRequest(c.req.raw)
})

app.get("/", (c) => {
  return c.json({ name: "zepp-mcp", status: "running" })
})

export default app
