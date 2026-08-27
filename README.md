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

## Tools

| Tool | Description |
| --- | --- |
| `zepp_status` | Check Zepp cloud login status and user ID |
| `get_devices` | List paired Zepp/Amazfit devices on the account |
| `get_daily_summary` | Per-day steps, distance, calories, and sleep summary over a date range |
| `list_workouts` | List recent workout/sport sessions (runs, walks, cycling, etc) |
| `get_workout_detail` | Full detail for one workout (GPS track, pace, heart rate series, etc), by `trackid` from `list_workouts` |
| `get_profile` | User profile data (weight, height, birthday, gender, etc) |
| `get_heart_rate_history` | Heart rate readings over a date range |
| `get_sleep_detail` | Sleep stage breakdown per night over a date range |
| `get_lactate_threshold` | Lactate threshold data, when available |

Date-range tools accept optional `from_date` / `to_date` in `YYYY-MM-DD` format and default to the last 30 days.

## Project structure

```
src/
  index.ts          Hono app, MCP server wiring, /mcp route
  tools/index.ts     MCP tool registrations
  zepp/
    auth.ts          Zepp login flow (token exchange + login)
    client.ts        ZeppClient: session caching + data API calls
    constants.ts      Zepp API URLs, headers, payload templates
    types.ts          Shared Zepp types
  lib/
    crypto.ts        AES-CBC helper used to encrypt the login token request
    kv-cache.ts       Session caching in Cloudflare KV
```

## Notes

- Session tokens are cached in KV for 24 hours and refreshed automatically on a 401/403 response.
- `wrangler.jsonc` and `.dev.vars` are gitignored since they hold your KV namespace ID and account credentials — use the checked-in `.example` files as templates.
