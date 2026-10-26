import type { McpServer } from "@modelcontextprotocol/server"
import { z } from "zod/v4"
import type { ZeppClient } from "../zepp/client"
import { EVENT_PRESETS, type EventPreset } from "../zepp/constants"

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")

const dateRange = (defaultDays: number) => ({
  from_date: date.optional().describe(`Start date (YYYY-MM-DD). Defaults to ${defaultDays} days before to_date.`),
  to_date: date.optional().describe("End date (YYYY-MM-DD). Defaults to today in the server's timezone."),
})

const json = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
})

const presetNames = Object.keys(EVENT_PRESETS) as [EventPreset, ...EventPreset[]]

export function registerTools(server: McpServer, client: ZeppClient) {
  server.registerTool(
    "zepp_status",
    {
      title: "Zepp Status",
      description: "Check Zepp cloud login status, user ID and the timezone used for dates",
    },
    async () => json(await client.getStatus())
  )

  server.registerTool(
    "get_devices",
    {
      title: "Get Devices",
      description: "List paired Zepp/Amazfit devices (watch/band) on the account",
    },
    async () => json(await client.getDevices())
  )

  server.registerTool(
    "get_daily_summary",
    {
      title: "Get Daily Summary",
      description:
        "Per-day steps, distance, calories, step goal and a compact sleep summary (total, deep, light, REM, awake, sleep score, resting HR). Defaults to the last 30 days.",
      inputSchema: z.object({
        ...dateRange(30),
        include_raw: z
          .boolean()
          .optional()
          .default(false)
          .describe("Also include Zepp's decoded raw summary (large)"),
      }),
    },
    async ({ from_date, to_date, include_raw }) =>
      json(await client.getDailySummary(from_date, to_date, include_raw))
  )

  server.registerTool(
    "get_sleep_detail",
    {
      title: "Get Sleep Detail",
      description:
        "Per-night sleep: bedtime, wake time, total sleep, deep/light/REM/awake minutes, wake count, sleep score, resting HR, the stage timeline (local HH:MM) and naps. Defaults to the last 14 days.",
      inputSchema: z.object({
        ...dateRange(14),
        include_stages: z
          .boolean()
          .optional()
          .default(true)
          .describe("Include the stage-by-stage timeline"),
      }),
    },
    async ({ from_date, to_date, include_stages }) =>
      json(await client.getSleepDetail(from_date, to_date, include_stages))
  )

  server.registerTool(
    "get_heart_rate_history",
    {
      title: "Get Heart Rate History",
      description:
        "Heart rate from the watch's all-day monitoring: per-day resting HR, average, min and max bpm. Optionally hourly buckets or the per-minute series (minute: max 3 days). Defaults to the last 7 days.",
      inputSchema: z.object({
        ...dateRange(7),
        resolution: z
          .enum(["daily", "hourly", "minute"])
          .optional()
          .default("daily")
          .describe("daily = one row per day; hourly = adds 24 buckets per day; minute = adds the per-minute series"),
      }),
    },
    async ({ from_date, to_date, resolution }) =>
      json(await client.getHeartRateHistory(from_date, to_date, resolution))
  )

  server.registerTool(
    "get_hrv",
    {
      title: "Get HRV",
      description:
        "Heart rate variability per night (ms): average, min, max and last of the night's samples, plus a range summary. rMSSD by default (the value the Zepp app shows). Defaults to the last 30 days.",
      inputSchema: z.object({
        ...dateRange(30),
        metric: z
          .enum(["rmssd", "sdnn"])
          .optional()
          .default("rmssd")
          .describe("HRV metric"),
        include_samples: z
          .boolean()
          .optional()
          .default(false)
          .describe("Include the raw samples of each night"),
      }),
    },
    async ({ from_date, to_date, metric, include_samples }) =>
      json(await client.getHrv(from_date, to_date, metric, include_samples))
  )

  server.registerTool(
    "get_readiness",
    {
      title: "Get Readiness",
      description:
        "Daily readiness (morning recovery score 0-100), skin temperature delta from baseline (°C) and breathing quality score. Defaults to the last 14 days.",
      inputSchema: z.object(dateRange(14)),
    },
    async ({ from_date, to_date }) => json(await client.getReadiness(from_date, to_date))
  )

  server.registerTool(
    "get_stress",
    {
      title: "Get Stress",
      description:
        "Daily all-day stress: average, min and max stress (0-100) plus Zepp's per-day breakdown fields. Defaults to the last 14 days.",
      inputSchema: z.object({
        ...dateRange(14),
        include_samples: z
          .boolean()
          .optional()
          .default(false)
          .describe("Include the intraday stress series"),
      }),
    },
    async ({ from_date, to_date, include_samples }) =>
      json(await client.getStress(from_date, to_date, include_samples))
  )

  server.registerTool(
    "get_lactate_threshold",
    {
      title: "Get Lactate Threshold",
      description:
        "Lactate threshold estimates (heart rate and pace) that Zepp computes after qualifying runs. Defaults to the last 180 days.",
      inputSchema: z.object(dateRange(180)),
    },
    async ({ from_date, to_date }) =>
      json(await client.getLactateThreshold(from_date, to_date))
  )

  server.registerTool(
    "get_health_events",
    {
      title: "Get Health Events",
      description:
        "Raw Zepp health event stream for metrics without a dedicated tool: body_battery, stress_samples, respiratory_rate, spo2, pai, daily_health, blood_pressure, emotion, hrv_sdnn, etc. Pick a preset, or pass event_type/sub_type/scope to query any stream. Defaults to the last 7 days.",
      inputSchema: z.object({
        preset: z.enum(presetNames).optional().describe("Known event stream"),
        event_type: z.string().optional().describe("Custom eventType (ignored if preset is set)"),
        sub_type: z.string().optional().describe("Custom subType"),
        scope: z
          .enum(["v2", "user"])
          .optional()
          .default("v2")
          .describe("v2 = /v2/users/me/events, user = /users/{id}/events"),
        ...dateRange(7),
        limit: z.number().int().min(1).max(1000).optional().default(200).describe("Max events"),
      }),
    },
    async ({ preset, event_type, sub_type, scope, from_date, to_date, limit }) => {
      const query = preset
        ? EVENT_PRESETS[preset]
        : event_type
          ? { eventType: event_type, subType: sub_type, scope }
          : null
      if (!query) throw new Error("Pass a preset or an event_type")
      return json(await client.getEvents(query, from_date, to_date, limit))
    }
  )

  server.registerTool(
    "list_workouts",
    {
      title: "List Workouts",
      description:
        "List recent workout/sport sessions (runs, walks, cycling, etc). Each item includes a trackid usable with get_workout_detail.",
      inputSchema: z.object({
        limit: z.number().optional().default(50).describe("Max number of workouts to return"),
      }),
    },
    async ({ limit }) => json(await client.listWorkouts(limit))
  )

  server.registerTool(
    "get_workout_detail",
    {
      title: "Get Workout Detail",
      description:
        "Full detail for one workout: GPS track, pace, heart-rate series, etc. Pass a trackid from list_workouts.",
      inputSchema: z.object({
        trackid: z.string().describe("Workout track ID from list_workouts"),
        source: z.string().optional().describe("Data source (auto-resolves if omitted)"),
      }),
    },
    async ({ trackid, source }) => json(await client.getWorkoutDetail(trackid, source))
  )

  server.registerTool(
    "get_profile",
    {
      title: "Get Profile",
      description: "Get user profile data (weight, height, birthday, gender, etc)",
    },
    async () => json(await client.getProfile())
  )
}
