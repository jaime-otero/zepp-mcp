import { URLS, HEADERS_DATA, ZEPP_CHANNEL } from "./constants"
import { fullLogin } from "./auth"
import { getCachedSession, setCachedSession, invalidateSession } from "../lib/kv-cache"
import type { ZeppCachedSession, ZeppDevice, ZeppWorkout, ZeppDailyEntry } from "./types"

export class ZeppClient {
  private session: ZeppCachedSession | null = null
  private kv: KVNamespace
  private email: string
  private password: string
  private sourceCache = new Map<string, string>()

  constructor(kv: KVNamespace, email: string, password: string) {
    this.kv = kv
    this.email = email
    this.password = password
  }

  async ensureSession(): Promise<ZeppCachedSession> {
    if (this.session) return this.session

    this.session = await getCachedSession(this.kv)
    if (this.session) return this.session

    const result = await fullLogin(this.email, this.password)
    this.session = {
      appToken: result.appToken,
      userId: result.userId,
      loginToken: result.loginToken,
    }
    await setCachedSession(this.kv, this.session)
    return this.session
  }

  private async relogin(): Promise<ZeppCachedSession> {
    await invalidateSession(this.kv)
    this.session = null
    return this.ensureSession()
  }

  private dataHeaders(appToken: string): Record<string, string> {
    return {
      ...HEADERS_DATA,
      apptoken: appToken,
      "x-request-id": crypto.randomUUID(),
    }
  }

  private async dataGet(
    path: string,
    params: Record<string, string>
  ): Promise<Record<string, unknown>> {
    const session = await this.ensureSession()
    const url = new URL(path, URLS.DATA_HOST)
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v)
    }

    let response = await fetch(url.toString(), {
      headers: this.dataHeaders(session.appToken),
    })

    if (response.status === 401 || response.status === 403) {
      const refreshed = await this.relogin()
      response = await fetch(url.toString(), {
        headers: this.dataHeaders(refreshed.appToken),
      })
    }

    if (!response.ok) {
      throw new Error(`Data request failed: ${response.status} ${url.pathname}`)
    }

    return (await response.json()) as Record<string, unknown>
  }

  async getStatus(): Promise<{ logged_in: boolean; user_id: string | null }> {
    try {
      const session = await this.ensureSession()
      return { logged_in: true, user_id: session.userId }
    } catch {
      return { logged_in: false, user_id: null }
    }
  }

  async getDevices(): Promise<ZeppDevice[]> {
    const session = await this.ensureSession()
    const r1 = crypto.randomUUID()
    const r2 = crypto.randomUUID()
    const appid = String(Math.floor(Math.random() * 2 ** 64))

    const params: Record<string, string> = {
      r: r1,
      enableMultiDeviceOnMultiType: "true",
      userid: session.userId,
      appid: appid,
      channel: ZEPP_CHANNEL,
      country: "US",
      cv: "151689_9.12.5",
      device: "android_32",
      device_type: "android_phone",
      enableMultiDevice: "true",
      lang: "en_US",
      timezone: "Europe/London",
      v: "2.0",
    }

    const url = new URL(`/users/${session.userId}/devices`, URLS.DATA_HOST)
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.append(k, v)
    }
    url.searchParams.append("r", r2)

    const response = await fetch(url.toString(), {
      headers: this.dataHeaders(session.appToken),
    })

    if (!response.ok) {
      throw new Error(`Get devices failed: ${response.status}`)
    }

    const data = (await response.json()) as Record<string, unknown>
    const items = (data.items ?? []) as ZeppDevice[]
    return items
  }

  async getDailySummary(
    fromDate?: string,
    toDate?: string
  ): Promise<ZeppDailyEntry[]> {
    const session = await this.ensureSession()
    const to = toDate ?? new Date().toISOString().slice(0, 10)
    const from =
      fromDate ??
      new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)

    const j = await this.dataGet("/v1/data/band_data.json", {
      query_type: "summary",
      device_type: "android_phone",
      userid: session.userId,
      from_date: from,
      to_date: to,
    })

    const days = (j.data ?? []) as Record<string, unknown>[]
    const out: ZeppDailyEntry[] = []

    for (const day of days) {
      const entry: ZeppDailyEntry = {
        date: (day.date_time as string) ?? (day.date as string),
      }

      const raw = day.summary
      if (raw) {
        const summary = maybeB64Json(raw)
        entry.summary = summary as Record<string, unknown> | undefined
        if (summary && typeof summary === "object") {
          const s = summary as Record<string, unknown>
          const stp = (s.stp ?? {}) as Record<string, number>
          const slp = (s.slp ?? {}) as Record<string, number>
          entry.steps = stp.ttl
          entry.distance_m = stp.dis
          entry.calories = stp.cal
          if (slp && Object.keys(slp).length > 0) {
            entry.sleep_minutes = (slp.lt ?? 0) + (slp.dp ?? 0) || slp.stage
          }
        }
      }
      out.push(entry)
    }

    return out
  }

  async listWorkouts(limit: number = 50): Promise<ZeppWorkout[]> {
    const session = await this.ensureSession()
    const j = await this.dataGet("/v1/sport/run/history.json", {
      source: "run.mi.com",
      userid: session.userId,
      limit: String(limit),
    })

    const items = extractList(j)
    for (const w of items) {
      if (w.trackid && w.source) {
        this.sourceCache.set(String(w.trackid), String(w.source))
      }
    }
    return items
  }

  async getWorkoutDetail(
    trackid: string,
    source?: string
  ): Promise<Record<string, unknown>> {
    const session = await this.ensureSession()
    const resolvedSource =
      source ?? this.sourceCache.get(trackid) ?? "run.mi.com"

    if (!this.sourceCache.has(trackid) && !source) {
      await this.listWorkouts(200)
    }

    const j = await this.dataGet("/v1/sport/run/detail.json", {
      trackid: String(trackid),
      source: this.sourceCache.get(trackid) ?? resolvedSource,
      userid: session.userId,
    })

    const data = (j.data ?? j) as Record<string, unknown>

    for (const k of [
      "longitude_latitude",
      "heart_rate",
      "pace",
      "altitude",
      "time",
      "gait",
    ]) {
      const v = data[k]
      if (typeof v === "string" && v.length > 200) {
        data[k] = { _encoded_len: v.length, _sample: v.slice(0, 120) }
      }
    }

    return data
  }

  async getProfile(): Promise<Record<string, unknown>> {
    const session = await this.ensureSession()
    const j = await this.dataGet(`/v1/users/${session.userId}/profile.json`, {
      userid: session.userId,
    })
    return (j.data ?? j) as Record<string, unknown>
  }

  async getHeartRateHistory(
    fromDate?: string,
    toDate?: string
  ): Promise<ZeppDailyEntry[]> {
    const session = await this.ensureSession()
    const to = toDate ?? new Date().toISOString().slice(0, 10)
    const from =
      fromDate ??
      new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)

    const j = await this.dataGet("/v1/data/band_data.json", {
      query_type: "summary",
      device_type: "android_phone",
      userid: session.userId,
      from_date: from,
      to_date: to,
    })

    const days = (j.data ?? []) as Record<string, unknown>[]
    const out: ZeppDailyEntry[] = []

    for (const day of days) {
      const entry: ZeppDailyEntry = {
        date: (day.date_time as string) ?? (day.date as string),
      }
      const raw = day.summary
      if (raw) {
        const summary = maybeB64Json(raw)
        if (summary && typeof summary === "object") {
          const s = summary as Record<string, unknown>
          const hrt = s.hrt as Record<string, unknown> | undefined
          if (hrt) {
            entry.summary = { heart_rate: hrt }
          }
        }
      }
      out.push(entry)
    }

    return out
  }

  async getSleepDetail(
    fromDate?: string,
    toDate?: string
  ): Promise<ZeppDailyEntry[]> {
    const session = await this.ensureSession()
    const to = toDate ?? new Date().toISOString().slice(0, 10)
    const from =
      fromDate ??
      new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)

    const j = await this.dataGet("/v1/data/band_data.json", {
      query_type: "summary",
      device_type: "android_phone",
      userid: session.userId,
      from_date: from,
      to_date: to,
    })

    const days = (j.data ?? []) as Record<string, unknown>[]
    const out: ZeppDailyEntry[] = []

    for (const day of days) {
      const entry: ZeppDailyEntry = {
        date: (day.date_time as string) ?? (day.date as string),
      }
      const raw = day.summary
      if (raw) {
        const summary = maybeB64Json(raw)
        if (summary && typeof summary === "object") {
          const s = summary as Record<string, unknown>
          const slp = s.slp as Record<string, unknown> | undefined
          if (slp) {
            entry.summary = { sleep: slp }
          }
        }
      }
      out.push(entry)
    }

    return out
  }

  async getLactateThreshold(
    fromDate?: string,
    toDate?: string
  ): Promise<Record<string, unknown>> {
    const session = await this.ensureSession()
    const to = toDate ?? new Date().toISOString().slice(0, 10)
    const from =
      fromDate ??
      new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)

    try {
      const j = await this.dataGet("/v1/data/band_data.json", {
        query_type: "summary",
        device_type: "android_phone",
        userid: session.userId,
        from_date: from,
        to_date: to,
      })

      const days = (j.data ?? []) as Record<string, unknown>[]
      for (const day of days) {
        const raw = day.summary
        if (raw) {
          const summary = maybeB64Json(raw)
          if (summary && typeof summary === "object") {
            const s = summary as Record<string, unknown>
            const keys = Object.keys(s)
            return {
              available_fields: keys,
              note: "Lactate threshold data may be embedded in workout detail responses rather than daily summaries. Try get_workout_detail for specific workout sessions that include lactate threshold estimates.",
              raw_summary_keys: keys,
            }
          }
        }
      }

      return { note: "No summary data found for lactate threshold" }
    } catch {
      return {
        note: "Lactate threshold endpoint not available. This data is typically embedded in workout detail responses. Use get_workout_detail for specific running workouts.",
      }
    }
  }
}

function maybeB64Json(raw: unknown): unknown {
  if (typeof raw === "object" && raw !== null) return raw
  if (typeof raw !== "string") return { _raw: raw }
  try {
    const decoded = atob(raw)
    return JSON.parse(decoded)
  } catch {
    try {
      return JSON.parse(raw)
    } catch {
      return { _raw: raw }
    }
  }
}

function extractList(j: Record<string, unknown>): ZeppWorkout[] {
  const data = (j.data ?? j) as Record<string, unknown>

  if (typeof data === "object" && data !== null) {
    const summary = data.summary
    const parsed =
      typeof summary === "string" ? JSON.parse(summary) : summary

    if (parsed && typeof parsed === "object") {
      const p = parsed as Record<string, unknown>
      if (Array.isArray(p.data)) return p.data as ZeppWorkout[]
    }

    if (Array.isArray(parsed)) return parsed as ZeppWorkout[]
    if (Array.isArray(data.items)) return data.items as ZeppWorkout[]
  }

  if (Array.isArray(data)) return data as ZeppWorkout[]
  return [{ trackid: "_raw" } as ZeppWorkout]
}
