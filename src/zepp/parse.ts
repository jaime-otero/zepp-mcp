import { formatWithOffset, localDateTime, stageMinuteToClock } from "../lib/time"
import type { ZeppEvent, ZeppSleepNight, ZeppSleepStage } from "./types"

export function maybeB64Json(raw: unknown): unknown {
  if (typeof raw === "object" && raw !== null) return raw
  if (typeof raw !== "string") return { _raw: raw }
  try {
    return JSON.parse(atob(raw))
  } catch {
    try {
      return JSON.parse(raw)
    } catch {
      return { _raw: raw }
    }
  }
}

export function decodeSummary(day: Record<string, unknown>): Record<string, unknown> | null {
  if (!day.summary) return null
  const s = maybeB64Json(day.summary)
  return s && typeof s === "object" ? (s as Record<string, unknown>) : null
}

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined

// Zepp stage modes, verified against the summary totals (lt/dp/dt/wk).
const SLEEP_STAGE_NAMES: Record<number, ZeppSleepStage["stage"]> = {
  4: "light",
  5: "deep",
  7: "awake",
  8: "rem",
}

function parseStages(raw: unknown): ZeppSleepStage[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((s): s is Record<string, number> => typeof s === "object" && s !== null)
    .sort((a, b) => a.start - b.start)
    .map((s) => ({
      start: stageMinuteToClock(s.start),
      end: stageMinuteToClock(s.stop + 1),
      stage: SLEEP_STAGE_NAMES[s.mode] ?? `mode_${s.mode}`,
      minutes: s.stop - s.start + 1,
    }))
}

export function parseSleep(
  date: string,
  summary: Record<string, unknown>,
  includeStages: boolean
): ZeppSleepNight | null {
  const slp = summary.slp as Record<string, unknown> | undefined
  if (!slp) return null

  const light = num(slp.lt) ?? 0
  const deep = num(slp.dp) ?? 0
  const rem = num(slp.dt) ?? 0
  const awake = num(slp.wk) ?? 0
  const total = light + deep + rem
  const offset = Number(summary.tz ?? 0) || 0

  const night: ZeppSleepNight = { date, total_sleep_min: total }
  if (total > 0) {
    const st = num(slp.st)
    const ed = num(slp.ed)
    if (st) night.bedtime = formatWithOffset(st, offset)
    if (ed) night.wake_time = formatWithOffset(ed, offset)
    night.deep_min = deep
    night.light_min = light
    night.rem_min = rem
    night.awake_min = awake
    if (num(slp.wc) !== undefined) night.wake_count = num(slp.wc)
    if (num(slp.ss)) night.sleep_score = num(slp.ss)
    if (num(slp.rhr)) night.resting_hr = num(slp.rhr)
    if (includeStages) night.stages = parseStages(slp.stage)
  }

  // Short sleeps outside the main night (naps), as Zepp's "odd_stage".
  const odd = parseStages(slp.odd_stage)
  if (odd.length > 0) {
    night.other_sleep = odd
    night.other_sleep_min = odd
      .filter((s) => s.stage !== "awake")
      .reduce((acc, s) => acc + s.minutes, 0)
  }
  return night
}

// One byte per minute from local midnight; out-of-range values mean "no reading".
export function decodeHeartRateBlob(b64: string): (number | null)[] {
  let bin: string
  try {
    bin = atob(b64)
  } catch {
    return []
  }
  const out: (number | null)[] = new Array(bin.length)
  for (let i = 0; i < bin.length; i++) {
    const v = bin.charCodeAt(i)
    out[i] = v >= 20 && v <= 240 ? v : null
  }
  return out
}

export function stats(values: number[]): { avg: number; min: number; max: number; count: number } | null {
  if (values.length === 0) return null
  let min = Infinity
  let max = -Infinity
  let sum = 0
  for (const v of values) {
    if (v < min) min = v
    if (v > max) max = v
    sum += v
  }
  return { avg: Math.round((sum / values.length) * 10) / 10, min, max, count: values.length }
}

// Merges an event's `value` payload (object or JSON string) into the event itself.
export function flattenEvent(item: Record<string, unknown>, tz: string): ZeppEvent {
  const { value, ...rest } = item
  let parsed: unknown = value
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value)
    } catch {
      parsed = value
    }
  }
  const out: ZeppEvent = { ...rest }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    Object.assign(out, parsed)
  } else if (parsed !== undefined) {
    out.value = parsed
  }
  const ts = num(item.timestamp)
  if (ts) out.local_time = localDateTime(ts, tz)
  return out
}

// Shrinks long strings/arrays so a single tool response stays readable.
export function compact(value: unknown, maxArray = 50, maxString = 300): unknown {
  if (typeof value === "string") {
    return value.length > maxString
      ? { _encoded_len: value.length, _sample: value.slice(0, 120) }
      : value
  }
  if (Array.isArray(value)) {
    if (value.length > maxArray) {
      return {
        _len: value.length,
        _first: value.slice(0, 5).map((v) => compact(v, maxArray, maxString)),
      }
    }
    return value.map((v) => compact(v, maxArray, maxString))
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = compact(v, maxArray, maxString)
    return out
  }
  return value
}
