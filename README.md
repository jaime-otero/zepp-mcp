# zepp-mcp

MCP server exposing Zepp/Amazfit health and fitness data (steps, sleep, heart rate, workouts) as tools for MCP clients (e.g. Claude). Built with [Hono](https://hono.dev/) and deployed on Cloudflare Workers.

It authenticates against Zepp's cloud API using your account email/password, caches the resulting session token in a Cloudflare KV namespace, and re-authenticates automatically when the cached token expires.

## Requirements

- Node.js and npm
- A [Cloudflare](https://dash.cloudflare.com/) account
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) (installed as a dev dependency)
- A Zepp/Amazfit account (email + password)

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create your Wrangler config from the example and fill in a KV namespace ID:

   ```bash
   cp wrangler.example.jsonc wrangler.jsonc
   ```

   Create the KV namespace if you don't have one yet, then paste its ID into `wrangler.jsonc`:

   ```bash
   npx wrangler kv namespace create ZEPP_KV
   ```

3. Create your local secrets file from the example:

   ```bash
   cp .dev.vars.example .dev.vars
   ```

   Fill in `ZEPP_EMAIL` and `ZEPP_PASSWORD` with your Zepp account credentials.

## Development

Run the server locally:

```bash
npm run dev
```

The MCP endpoint is served at `/mcp` (Streamable HTTP transport). `/` returns a basic status JSON payload.

Type-check the project:

```bash
npm run typecheck
```

## Deployment

```bash
npm run deploy
```

Before deploying, set the same secrets in your Cloudflare Worker (instead of `.dev.vars`):

```bash
npx wrangler secret put ZEPP_EMAIL
npx wrangler secret put ZEPP_PASSWORD
```

After deploying, Wrangler prints the Worker's public URL (e.g. `https://zepp-mcp.<your-subdomain>.workers.dev`). The MCP endpoint is that URL plus `/mcp`, e.g. `https://zepp-mcp.<your-subdomain>.workers.dev/mcp`. By default the endpoint has no authentication — anyone with the URL can call it — so treat it as a secret, or set `MCP_AUTH_TOKEN` (see [Configuration](#configuration)).

## Using the deployed MCP server

Point any MCP client that supports the Streamable HTTP transport at `https://<your-worker-url>/mcp`.

**Claude Code**

```bash
claude mcp add --transport http zepp https://zepp-mcp.<your-subdomain>.workers.dev/mcp
```

**Claude Desktop**

Claude Desktop connects to remote HTTP servers via a local stdio proxy (`mcp-remote`). Add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "zepp": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://zepp-mcp.<your-subdomain>.workers.dev/mcp"]
    }
  }
}
```

Restart Claude Desktop after editing the config. The `zepp_*` tools should then show up in the tool picker.

**Other MCP clients**

Any client with native Streamable HTTP support (e.g. Cursor, Windsurf) can be pointed directly at the `/mcp` URL — check that client's docs for its config format. Clients that only support stdio servers can use the `mcp-remote` proxy pattern shown above.

## Tools

| Tool | Description |
| --- | --- |
| `zepp_status` | Check Zepp cloud login status, user ID and the timezone used for dates |
| `get_devices` | List paired Zepp/Amazfit devices on the account (the Bluetooth auth key is stripped) |
| `get_daily_summary` | Per-day steps, distance, calories, step goal and a compact sleep summary (`include_raw` adds Zepp's decoded payload) |
| `get_sleep_detail` | Per-night bedtime, wake time, total/deep/light/REM/awake minutes, sleep score, resting HR, stage timeline and naps |
| `get_heart_rate_history` | All-day heart rate: per-day resting/avg/min/max bpm, optionally `hourly` or per-`minute` (max 3 days) |
| `get_hrv` | Nightly HRV as the Zepp app shows it (sleep HRV, baseline, score) plus the raw rMSSD/SDNN samples per upload window |
| `get_readiness` | Daily readiness score with its components: HRV, resting HR, skin temperature, breathing, physical/mental baselines |
| `get_stress` | Daily all-day stress (avg/min/max and % relaxed/normal/medium/high), optionally with the 5-minute series |
| `get_lactate_threshold` | Lactate threshold estimates Zepp computes after qualifying runs |
| `get_health_events` | Raw event streams by preset (`body_battery`, `respiratory_rate`, `spo2`, `pai`, `blood_pressure`, ...) or any `event_type`/`sub_type` |
| `list_workouts` | List recent workout/sport sessions (runs, walks, cycling, etc) |
| `get_workout_detail` | Full detail for one workout (GPS track, pace, heart rate series, etc), by `trackid` from `list_workouts` |
| `get_profile` | User profile data (weight, height, birthday, gender, etc) |

Date-range tools accept optional `from_date` / `to_date` in `YYYY-MM-DD` format, interpreted in `ZEPP_TIMEZONE`. Each tool's description states its default range.

HRV, readiness, stress and the other event-based metrics only exist if the watch records them (recent Zepp OS watches do); otherwise the tools return an empty list.

## Configuration

| Variable | Required | Description |
| --- | --- | --- |
| `ZEPP_EMAIL`, `ZEPP_PASSWORD` | yes | Zepp account credentials (secrets) |
| `ZEPP_TIMEZONE` | no | IANA timezone for dates, e.g. `Europe/Madrid` (the default) |
| `MCP_AUTH_TOKEN` | no | When set, `/mcp` requires the token as `Authorization: Bearer <token>`, a `?key=<token>` query parameter, or in the path: `/mcp/<token>` |

Set `ZEPP_TIMEZONE` under `vars` in `wrangler.jsonc`, and `MCP_AUTH_TOKEN` as a secret:

```bash
npx wrangler secret put MCP_AUTH_TOKEN
```

With a token set, clients that cannot send headers (such as a claude.ai custom connector) can use `https://<your-worker-url>/mcp/<token>` or `https://<your-worker-url>/mcp?key=<token>`.

## Project structure

```
src/
  index.ts          Hono app, MCP server wiring, /mcp route
  tools/index.ts     MCP tool registrations
  zepp/
    auth.ts          Zepp login flow (token exchange + login)
    client.ts        ZeppClient: session caching + data and event API calls
    parse.ts         Decoding of band data (sleep, per-minute HR) and events
    constants.ts      Zepp API URLs, headers, payload templates, event presets
    types.ts          Shared Zepp types
  lib/
    crypto.ts        AES-CBC helper used to encrypt the login token request
    kv-cache.ts       Session caching in Cloudflare KV
    time.ts          Timezone-aware date helpers
```

## Notes

- Session tokens are cached in KV for 24 hours and refreshed automatically on a 401/403 response.
- Event streams (HRV, readiness, stress, ...) are read from the account's regional host taken from the login response, falling back to `api-mifit.zepp.com`. Sessions cached before this was added trigger one fresh login to pick it up.
- `wrangler.jsonc` is committed so Cloudflare Workers Builds can deploy on push; it only holds the KV namespace ID (not usable without your Cloudflare account). `.dev.vars` is gitignored since it holds your account credentials — use `.dev.vars.example` as a template. Credentials in production are Worker secrets.
