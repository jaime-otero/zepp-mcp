import type { McpServer } from "@modelcontextprotocol/server"
import { z } from "zod/v4"
import type { ZeppClient } from "../zepp/client"

export function registerTools(server: McpServer, client: ZeppClient) {
  server.registerTool(
    "zepp_status",
    {
      title: "Zepp Status",
      description: "Check Zepp cloud login status and user ID",
    },
    async () => {
      const status = await client.getStatus()
      return {
        content: [{ type: "text", text: JSON.stringify(status, null, 2) }],
      }
    }
  )

  server.registerTool(
    "get_devices",
    {
      title: "Get Devices",
      description: "List paired Zepp/Amazfit devices (watch/band) on the account",
    },
    async () => {
      const devices = await client.getDevices()
      return {
        content: [{ type: "text", text: JSON.stringify(devices, null, 2) }],
      }
    }
  )

  server.registerTool(
    "get_daily_summary",
    {
      title: "Get Daily Summary",
      description:
        "Per-day steps, distance, calories, and sleep summary. Dates are ISO YYYY-MM-DD. Defaults to the last 30 days.",
      inputSchema: z.object({
        from_date: z.string().optional().describe("Start date (YYYY-MM-DD)"),
        to_date: z.string().optional().describe("End date (YYYY-MM-DD)"),
      }),
    },
    async ({ from_date, to_date }) => {
      const summary = await client.getDailySummary(from_date, to_date)
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      }
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
    async ({ limit }) => {
      const workouts = await client.listWorkouts(limit)
      return {
        content: [{ type: "text", text: JSON.stringify(workouts, null, 2) }],
      }
    }
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
    async ({ trackid, source }) => {
      const detail = await client.getWorkoutDetail(trackid, source)
      return {
        content: [{ type: "text", text: JSON.stringify(detail, null, 2) }],
      }
    }
  )

  server.registerTool(
    "get_profile",
    {
      title: "Get Profile",
      description: "Get user profile data (weight, height, birthday, gender, etc)",
    },
    async () => {
      const profile = await client.getProfile()
      return {
        content: [{ type: "text", text: JSON.stringify(profile, null, 2) }],
      }
    }
  )

  server.registerTool(
    "get_heart_rate_history",
    {
      title: "Get Heart Rate History",
      description:
        "Get heart rate readings over a date range. Dates are ISO YYYY-MM-DD. Defaults to the last 30 days.",
      inputSchema: z.object({
        from_date: z.string().optional().describe("Start date (YYYY-MM-DD)"),
        to_date: z.string().optional().describe("End date (YYYY-MM-DD)"),
      }),
    },
    async ({ from_date, to_date }) => {
      const hr = await client.getHeartRateHistory(from_date, to_date)
      return {
        content: [{ type: "text", text: JSON.stringify(hr, null, 2) }],
      }
    }
  )

  server.registerTool(
    "get_sleep_detail",
    {
      title: "Get Sleep Detail",
      description:
        "Get sleep stage breakdown per night. Dates are ISO YYYY-MM-DD. Defaults to the last 30 days.",
      inputSchema: z.object({
        from_date: z.string().optional().describe("Start date (YYYY-MM-DD)"),
        to_date: z.string().optional().describe("End date (YYYY-MM-DD)"),
      }),
    },
    async ({ from_date, to_date }) => {
      const sleep = await client.getSleepDetail(from_date, to_date)
      return {
        content: [{ type: "text", text: JSON.stringify(sleep, null, 2) }],
      }
    }
  )

  server.registerTool(
    "get_lactate_threshold",
    {
      title: "Get Lactate Threshold",
      description:
        "Get lactate threshold data. This data is typically embedded in workout detail responses for running workouts. Dates are ISO YYYY-MM-DD.",
      inputSchema: z.object({
        from_date: z.string().optional().describe("Start date (YYYY-MM-DD)"),
        to_date: z.string().optional().describe("End date (YYYY-MM-DD)"),
      }),
    },
    async ({ from_date, to_date }) => {
      const lactate = await client.getLactateThreshold(from_date, to_date)
      return {
        content: [{ type: "text", text: JSON.stringify(lactate, null, 2) }],
      }
    }
  )
}
