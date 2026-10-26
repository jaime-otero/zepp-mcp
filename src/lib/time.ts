const DAY_MS = 86400000

export function resolveTimezone(tz: string | undefined, fallback: string): string {
  const candidate = tz?.trim() || fallback
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate })
    return candidate
  } catch {
    return "UTC"
  }
}

function zonedParts(epochMs: number, tz: string): Record<string, number> {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
  const out: Record<string, number> = {}
  for (const p of fmt.formatToParts(new Date(epochMs))) {
    if (p.type !== "literal") out[p.type] = Number(p.value)
  }
  return out
}

// Offset of `tz` from UTC at the given instant, in milliseconds.
function tzOffsetMs(epochMs: number, tz: string): number {
  const p = zonedParts(epochMs, tz)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(epochMs / 1000) * 1000
}

const pad = (n: number) => String(n).padStart(2, "0")

export function localDate(epochMs: number, tz: string): string {
  const p = zonedParts(epochMs, tz)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

export function localDateTime(epochMs: number, tz: string): string {
  const p = zonedParts(epochMs, tz)
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`
}

// Epoch ms of 00:00 local time on `date` (YYYY-MM-DD) in `tz`.
export function localMidnightMs(date: string, tz: string): number {
  const [y, m, d] = date.split("-").map(Number)
  const guess = Date.UTC(y, m - 1, d)
  const off = tzOffsetMs(guess, tz)
  let result = guess - off
  const off2 = tzOffsetMs(result, tz)
  if (off2 !== off) result = guess - off2
  return result
}

export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10)
}

export interface DateRange {
  from: string
  to: string
}

export function resolveRange(
  tz: string,
  fromDate: string | undefined,
  toDate: string | undefined,
  defaultDays: number
): DateRange {
  const to = toDate ?? localDate(Date.now(), tz)
  const from = fromDate ?? shiftDate(to, -(defaultDays - 1))
  return { from, to }
}

// [start of `from`, end of `to`] in epoch ms, both in local time.
export function rangeToMs(range: DateRange, tz: string): { fromMs: number; toMs: number } {
  return {
    fromMs: localMidnightMs(range.from, tz),
    toMs: localMidnightMs(shiftDate(range.to, 1), tz) - 1,
  }
}

export function daysInRange(range: DateRange): number {
  const [a, b] = [range.from, range.to].map((s) => {
    const [y, m, d] = s.split("-").map(Number)
    return Date.UTC(y, m - 1, d)
  })
  return Math.max(1, Math.round((b - a) / DAY_MS) + 1)
}

// Formats a Unix epoch (seconds) using a fixed UTC offset in seconds, as Zepp's
// daily summaries report it (`tz` field).
export function formatWithOffset(epochSec: number, offsetSec: number): string {
  return new Date((epochSec + offsetSec) * 1000).toISOString().slice(0, 16).replace("T", " ")
}

// Zepp sleep/step stages count minutes from local midnight of the previous day.
export function stageMinuteToClock(minute: number): string {
  const m = ((minute % 1440) + 1440) % 1440
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
}
