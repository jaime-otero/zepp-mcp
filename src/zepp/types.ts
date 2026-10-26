export interface ZeppTokenResult {
  accessToken: string
  refreshToken: string
}

export interface ZeppLoginResult {
  appToken: string
  loginToken: string
  userId: string
  regionHosts: string[]
}

export interface ZeppCachedSession {
  appToken: string
  userId: string
  loginToken: string
  // Regional api-mifit hosts from the login response; absent in older caches.
  regionHosts?: string[]
}

export interface ZeppDevice {
  mac: string
  authKey?: string
  name?: string
  active?: boolean
  [key: string]: unknown
}

export interface ZeppWorkout {
  trackid: string
  type?: number
  dis?: number
  calorie?: number
  avg_heart_rate?: number
  max_heart_rate?: number
  pace?: string
  city?: string
  source?: string
  [key: string]: unknown
}

export interface ZeppDailyEntry {
  date: string
  steps?: number
  distance_m?: number
  calories?: number
  step_goal?: number
  sleep?: ZeppSleepNight | null
  last_sync?: string
  summary?: Record<string, unknown>
}

export interface ZeppSleepStage {
  start: string
  end: string
  stage: "light" | "deep" | "rem" | "awake" | `mode_${number}`
  minutes: number
}

export interface ZeppSleepNight {
  date: string
  total_sleep_min: number
  bedtime?: string
  wake_time?: string
  deep_min?: number
  light_min?: number
  rem_min?: number
  awake_min?: number
  wake_count?: number
  sleep_score?: number
  resting_hr?: number
  stages?: ZeppSleepStage[]
  other_sleep?: ZeppSleepStage[]
  other_sleep_min?: number
}

export interface ZeppEvent {
  timestamp?: number
  local_time?: string
  [key: string]: unknown
}

// "v2" = /v2/users/me/events (watch-centric), "user" = /users/{id}/events.
export type ZeppEventScope = "v2" | "user"

export interface ZeppEventQuery {
  eventType: string
  subType?: string
  scope: ZeppEventScope
}
