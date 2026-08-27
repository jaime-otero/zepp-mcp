export interface ZeppTokenResult {
  accessToken: string
  refreshToken: string
}

export interface ZeppLoginResult {
  appToken: string
  loginToken: string
  userId: string
}

export interface ZeppCachedSession {
  appToken: string
  userId: string
  loginToken: string
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
  date?: string
  steps?: number
  distance_m?: number
  calories?: number
  sleep_minutes?: number
  summary?: Record<string, unknown>
  [key: string]: unknown
}
