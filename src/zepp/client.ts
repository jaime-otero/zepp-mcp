import { URLS, HEADERS_DATA, ZEPP_CHANNEL, EVENT_PRESETS } from "./constants"
import { fullLogin } from "./auth"
import { getCachedSession, setCachedSession, invalidateSession } from "../lib/kv-cache"
import {
  daysInRange,
  formatWithOffset,
  localDate,
  rangeToMs,
  resolveRange,
  type DateRange,
} from "../lib/time"
import {
  compact,
  decodeHeartRateBlob,
  decodeSummary,
  flattenEvent,
  parseSleep,
  stats,
} from "./parse"
import type {
  ZeppCachedSession,
  ZeppDevice,
  ZeppWorkout,
  ZeppDailyEntry,
  ZeppEvent,
  ZeppEventQuery,
  ZeppSleepNight,
} from "./types"

type Params = Record<string, string> | [string, string][]

export interface EventsResult {
  events: ZeppEvent[]
  // True when the API returned exactly `limit` items, so older ones may be missing.
  truncated: boolean
}

// Keys that only describe the stream, not the measurement.
const EVENT_META_KEYS = new Set(["eventType", "subType", "userId", "timestamp"])

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined

export class ZeppClient {
  private session: ZeppCachedSession | null = null
  private kv: KVNamespace
  private email: string
  private password: string
  readonly timezone: string
  private sourceCache = new Map<string, string>()
  private eventHost: string | null = null

  constructor(kv: KVNamespace, email: string, password: string, timezone: string) {
    this.kv = kv
    this.email = email
    this.password = password
    this.timezone = timezone
  }

  async ensureSession(): Promise<ZeppCachedSession> {
    if (this.session) return this.session

    // Sessions cached before regional hosts were stored need one fresh login.
    const cached = await getCachedSession(this.kv)
    if (cached?.regionHosts) {
      this.session = cached
      return cached
    }

    const result = await fullLogin(this.email, this.password)
    this.session = {
      appToken: result.appToken,
      userId: result.userId,
      loginToken: result.loginToken,
      regionHosts: result.regionHosts,
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
      timezone: this.timezone,
      apptoken: appToken,
      "x-request-id": crypto.randomUUID(),
    }
  }

  // GET with one re-login retry on 401/403. Returns the raw response.
  private async request(host: string, path: string, params: Params): Promise<Response> {
    const session = await this.ensureSession()
    const url = new URL(path, host)
    const entries = Array.isArray(params) ? params : Object.entries(params)
    for (const [k, v] of entries) url.searchParams.append(k, v)

    let response = await fetch(url.toString(), {
      headers: this.dataHeaders(session.appToken),
    })

    if (response.status === 401 || response.status === 403) {
      const refreshed = await this.relogin()
      response = await fetch(url.toString(), {
        headers: this.dataHeaders(refreshed.appToken),
      })
    }
    return response
  }

  private async dataGet(path: string, params: Params): Promise<Record<string, unknown>> {
    const response = await this.request(URLS.DATA_HOST, path, params)
    if (!response.ok) {
      throw new Error(`Data request failed: ${response.status} ${path}`)
    }
    return (await response.json()) as Record<string, unknown>
  }

  private range(fromDate: string | undefined, toDate: string | undefined, defaultDays: number): DateRange {
    return resolveRange(this.timezone, fromDate, toDate, defaultDays)
  }

  private async bandData(range: DateRange, queryType: "summary" | "detail") {
    const session = await this.ensureSession()
    const j = await this.dataGet("/v1/data/band_data.json", {
      query_type: queryType,
      device_type: "android_phone",
      userid: session.userId,
      from_date: range.from,
      to_date: range.to,
    })
    const days = (Array.isArray(j.data) ? j.data : []) as Record<string, unknown>[]
    return days.map((day) => ({
      date: String(day.date_time ?? day.date ?? ""),
      day,
      summary: decodeSummary(day),
    }))
  }

  // Event streams live on the account's regional host; fall back to the global one.
  private eventHosts(session: ZeppCachedSession): string[] {
    const hosts = [...(session.regionHosts ?? []), URLS.DATA_HOST]
    if (this.eventHost) hosts.unshift(this.eventHost)
    return [...new Set(hosts)]
  }

  async fetchEvents(query: ZeppEventQuery, range: DateRange, limit: number): Promise<EventsResult> {
    const session = await this.ensureSession()
    const { fromMs, toMs } = rangeToMs(range, this.timezone)
    const path =
      query.scope === "v2" ? "/v2/users/me/events" : `/users/${session.userId}/events`
    const params: Record<string, string> = {
      eventType: query.eventType,
      from: String(fromMs),
      to: String(toMs),
      limit: String(limit),
    }
    if (query.subType) params.subType = query.subType
    if (query.scope === "user") params.userId = session.userId

    let sawOk = false
    let lastError = ""
    for (const host of this.eventHosts(session)) {
      let response: Response
      try {
        response = await this.request(host, path, params)
      } catch (err) {
        lastError = `${host}: ${err instanceof Error ? err.message : String(err)}`
        continue
      }
      if (!response.ok) {
        lastError = `${host}: HTTP ${response.status}`
        continue
      }
      sawOk = true
      const j = (await response.json()) as Record<string, unknown>
      const items = (Array.isArray(j.items) ? j.items : Array.isArray(j.data) ? j.data : []) as Record<string, unknown>[]
      if (items.length === 0) continue

      this.eventHost = host
      const events = items
        .map((it) => flattenEvent(it, this.timezone))
        .sort((a, b) => (num(a.timestamp) ?? 0) - (num(b.timestamp) ?? 0))
      return { events, truncated: items.length >= limit }
    }

    if (sawOk) return { events: [], truncated: false }
    throw new Error(`Event request failed (${query.eventType}): ${lastError}`)
  }

  private eventDate(ev: ZeppEvent): string | undefined {
    const ts = num(ev.timestamp)
    return ts ? localDate(ts, this.timezone) : undefined
  }

  // Scalar measurement fields of an event, minus stream metadata and `omit`.
  private scalarFields(ev: ZeppEvent, omit: string[] = []): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(ev)) {
      if (EVENT_META_KEYS.has(k) || omit.includes(k) || k === "local_time") continue
      if (v === null || typeof v !== "object") out[k] = v
    }
    return out
  }

  async getStatus(): Promise<{ logged_in: boolean; user_id: string | null; timezone: string }> {
    try {
      const session = await this.ensureSession()
      return { logged_in: true, user_id: session.userId, timezone: this.timezone }
    } catch {
      return { logged_in: false, user_id: null, timezone: this.timezone }
    }
  }

  async getDevices(): Promise<ZeppDevice[]> {
    const session = await this.ensureSession()
    const params: [string, string][] = [
      ["r", crypto.randomUUID()],
      ["enableMultiDeviceOnMultiType", "true"],
      ["userid", session.userId],
      ["appid", String(Math.floor(Math.random() * 2 ** 64))],
      ["channel", ZEPP_CHANNEL],
      ["country", "US"],
      ["cv", "151689_9.12.5"],
      ["device", "android_32"],
      ["device_type", "android_phone"],
      ["enableMultiDevice", "true"],
      ["lang", "en_US"],
      ["timezone", this.timezone],
      ["v", "2.0"],
      ["r", crypto.randomUUID()],
    ]

    const data = await this.dataGet(`/users/${session.userId}/devices`, params)
    const items = (data.items ?? []) as ZeppDevice[]
    return items.map(redactDevice)
  }

  async getDailySummary(
    fromDate?: string,
    toDate?: string,
    includeRaw = false
  ): Promise<ZeppDailyEntry[]> {
    const days = await this.bandData(this.range(fromDate, toDate, 30), "summary")
    return days.map(({ date, summary }) => {
      const entry: ZeppDailyEntry = { date }
      if (!summary) return entry
      const stp = (summary.stp ?? {}) as Record<string, unknown>
      entry.steps = num(stp.ttl)
      entry.distance_m = num(stp.dis)
      entry.calories = num(stp.cal)
      entry.step_goal = num(summary.goal)
      entry.sleep = parseSleep(date, summary, false)
      const sync = num(summary.sync)
      if (sync) entry.last_sync = formatWithOffset(sync, Number(summary.tz ?? 0) || 0)
      if (includeRaw) entry.summary = compact(summary) as Record<string, unknown>
      return entry
    })
  }

  async getSleepDetail(
    fromDate?: string,
    toDate?: string,
    includeStages = true
  ): Promise<ZeppSleepNight[]> {
    const days = await this.bandData(this.range(fromDate, toDate, 14), "summary")
    const out: ZeppSleepNight[] = []
    for (const { date, summary } of days) {
      const night = summary ? parseSleep(date, summary, includeStages) : null
      out.push(night ?? { date, total_sleep_min: 0 })
    }
    return out
  }

  async getHeartRateHistory(
    fromDate?: string,
    toDate?: string,
    resolution: "daily" | "hourly" | "minute" = "daily"
  ): Promise<Record<string, unknown>[]> {
    const range = this.range(fromDate, toDate, 7)
    if (resolution === "minute" && daysInRange(range) > 3) {
      throw new Error("resolution=minute is limited to 3 days; narrow the date range")
    }
    const days = await this.bandData(range, "detail")

    return days.map(({ date, day, summary }) => {
      const minutes = typeof day.data_hr === "string" ? decodeHeartRateBlob(day.data_hr) : []
      const valid = minutes.filter((v): v is number => v !== null)
      const s = stats(valid)
      const slp = (summary?.slp ?? {}) as Record<string, unknown>
      const entry: Record<string, unknown> = {
        date,
        resting_hr: num(slp.rhr) || undefined,
        avg_bpm: s?.avg,
        min_bpm: s?.min,
        max_bpm: s?.max,
        minutes_with_data: valid.length,
      }

      if (resolution === "hourly") {
        const hourly = []
        for (let h = 0; h < 24; h++) {
          const hs = stats(
            minutes.slice(h * 60, (h + 1) * 60).filter((v): v is number => v !== null)
          )
          if (hs) {
            hourly.push({ hour: `${String(h).padStart(2, "0")}:00`, avg: hs.avg, min: hs.min, max: hs.max })
          }
        }
        entry.hourly = hourly
      } else if (resolution === "minute") {
        const series: [string, number][] = []
        minutes.forEach((v, i) => {
          if (v === null) return
          const hh = String(Math.floor(i / 60)).padStart(2, "0")
          const mm = String(i % 60).padStart(2, "0")
          series.push([`${hh}:${mm}`, v])
        })
        entry.minutes = series
      }
      return entry
    })
  }

  async getHrv(
    fromDate?: string,
    toDate?: string,
    metric: "rmssd" | "sdnn" = "rmssd",
    includeSamples = false
  ): Promise<Record<string, unknown>> {
    const range = this.range(fromDate, toDate, 30)
    const preset = metric === "sdnn" ? EVENT_PRESETS.hrv_sdnn : EVENT_PRESETS.hrv_rmssd
    const { events, truncated } = await this.fetchEvents(preset, range, Math.min(1000, daysInRange(range) * 4 + 10))

    const nights = events.map((ev) => {
      const samples = Array.isArray(ev.samples) ? (ev.samples as unknown[]) : []
      const values = samples
        .map((sm) => {
          if (typeof sm === "number") return sm
          if (!sm || typeof sm !== "object") return undefined
          const o = sm as Record<string, unknown>
          return num(o.hrv) ?? num(o[metric]) ?? num(o.value)
        })
        .filter((v): v is number => v !== undefined && v > 0)
      const s = stats(values)
      const single = num(ev.hrv) ?? num(ev[metric])

      const night: Record<string, unknown> = {
        date: this.eventDate(ev),
        local_time: ev.local_time,
        avg_ms: s ? Math.round(s.avg) : single,
        min_ms: s?.min,
        max_ms: s?.max,
        last_ms: values.length ? values[values.length - 1] : undefined,
        samples_count: values.length,
        ...this.scalarFields(ev, ["hrv", metric]),
      }
      if (includeSamples) night.samples = compact(samples, 500)
      return night
    })

    const avgs = nights.map((n) => n.avg_ms).filter((v): v is number => typeof v === "number")
    const overall = stats(avgs)
    return {
      metric,
      unit: "ms",
      range,
      summary: overall
        ? { nights: overall.count, avg_ms: Math.round(overall.avg), min_night_ms: overall.min, max_night_ms: overall.max }
        : null,
      nights,
      truncated,
      note:
        nights.length === 0
          ? "No HRV events in this range. The watch may not record HRV, or it has not synced yet."
          : "avg_ms is the mean of the night's samples, which is the value the Zepp app shows.",
    }
  }

  async getReadiness(fromDate?: string, toDate?: string): Promise<Record<string, unknown>[]> {
    const range = this.range(fromDate, toDate, 14)
    const limit = Math.min(1000, daysInRange(range) * 3 + 10)
    let { events } = await this.fetchEvents(EVENT_PRESETS.readiness, range, limit)
    if (events.length === 0) {
      ;({ events } = await this.fetchEvents(
        { eventType: "readiness", subType: "watch_score", scope: "user" },
        range,
        limit
      ))
    }

    const valid = (v: unknown, invalid: number[] = [255]) => {
      const n = num(v)
      return n === undefined || invalid.includes(n) ? undefined : n
    }
    const known = ["rdnsScore", "skinTempCalibrated", "skinTempScore", "skinTempBaseLine", "ahiScore"]

    return events.map((ev) => {
      const skin = valid(ev.skinTempCalibrated)
      const ahi = num(ev.ahiScore)
      return {
        date: this.eventDate(ev),
        local_time: ev.local_time,
        readiness_score: num(ev.rdnsScore),
        skin_temp_delta_c: skin === undefined ? undefined : skin / 100,
        skin_temp_score: valid(ev.skinTempScore),
        skin_temp_baseline: valid(ev.skinTempBaseLine, [255, -10]),
        breathing_score: ahi !== undefined && ahi >= 0 ? ahi : undefined,
        other: this.scalarFields(ev, known),
      }
    })
  }

  async getStress(
    fromDate?: string,
    toDate?: string,
    includeSamples = false
  ): Promise<Record<string, unknown>[]> {
    const range = this.range(fromDate, toDate, 14)
    const { events } = await this.fetchEvents(
      EVENT_PRESETS.stress_daily,
      range,
      Math.min(1000, daysInRange(range) * 2 + 10)
    )
    return events.map((ev) => {
      const entry: Record<string, unknown> = {
        date: this.eventDate(ev),
        avg_stress: num(ev.avgStress),
        min_stress: num(ev.minStress),
        max_stress: num(ev.maxStress),
        ...this.scalarFields(ev, ["avgStress", "minStress", "maxStress"]),
      }
      if (includeSamples) {
        for (const [k, v] of Object.entries(ev)) {
          if (v !== null && typeof v === "object") entry[k] = compact(v, 300)
        }
      }
      return entry
    })
  }

  async getLactateThreshold(fromDate?: string, toDate?: string): Promise<Record<string, unknown>> {
    const range = this.range(fromDate, toDate, 180)
    const { events } = await this.fetchEvents(EVENT_PRESETS.lactate_threshold, range, 200)
    return {
      range,
      estimates: events.map((ev) => ({ date: this.eventDate(ev), ...(compact(ev) as object) })),
      note:
        events.length === 0
          ? "No lactate threshold estimates in this range. Zepp only estimates it after qualifying outdoor runs."
          : undefined,
    }
  }

  async getEvents(
    query: ZeppEventQuery,
    fromDate?: string,
    toDate?: string,
    limit = 200
  ): Promise<Record<string, unknown>> {
    const range = this.range(fromDate, toDate, 7)
    const { events, truncated } = await this.fetchEvents(query, range, limit)
    return { query, range, count: events.length, truncated, events: compact(events, 200) }
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
    if (!source && !this.sourceCache.has(trackid)) {
      await this.listWorkouts(200)
    }

    const j = await this.dataGet("/v1/sport/run/detail.json", {
      trackid: String(trackid),
      source: source ?? this.sourceCache.get(trackid) ?? "run.mi.com",
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
}

// additionalInfo carries the watch's Bluetooth auth key; never return it.
function redactDevice(device: ZeppDevice): ZeppDevice {
  const out: ZeppDevice = { ...device }
  delete out.authKey
  if (typeof out.additionalInfo === "string") {
    try {
      const info = JSON.parse(out.additionalInfo) as Record<string, unknown>
      delete info.auth_key
      out.additionalInfo = info
    } catch {
      delete out.additionalInfo
    }
  }
  return out
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
