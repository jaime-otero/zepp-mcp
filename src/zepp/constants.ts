const encoder = new TextEncoder()

export const ZEPP_ENCRYPTION_KEY = encoder.encode("xeNtBVqzDc6tuNTh")
export const ZEPP_ENCRYPTION_IV = encoder.encode("MAAAYAAAAAAAAABg")

export const ZEPP_CHANNEL = "a100900101016"

export const URLS = {
  TOKENS: "https://api-user-us2.zepp.com/v2/registrations/tokens",
  LOGIN: "https://api-mifit-us2.zepp.com/v2/client/login",
  LOGOUT: "https://api-mifit-us2.zepp.com/v1/client/logout",
  DATA_HOST: "https://api-mifit.zepp.com",
} as const

export const TOKENS_PAYLOAD: Record<string, string | string[]> = {
  emailOrPhone: "",
  state: "REDIRECTION",
  client_id: "HuaMi",
  password: "",
  redirect_uri:
    "https://s3-us-west-2.amazonaws.com/hm-registration/successsignin.html",
  region: "us-west-2",
  token: ["access", "refresh"],
  country_code: "US",
}

export const LOGIN_PAYLOAD: Record<string, string> = {
  code: "",
  device_id: "",
  device_model: "android_phone",
  app_version: "9.12.5",
  dn: "api-mifit.zepp.com,api-user.zepp.com,api-mifit.zepp.com,api-watch.zepp.com,app-analytics.zepp.com,auth.zepp.com,api-analytics.zepp.com",
  third_name: "huami",
  source: "com.huami.watch.hmwatchmanager:9.12.5:151689",
  app_name: "com.huami.midong",
  country_code: "US",
  grant_type: "access_token",
  allow_registration: "false",
  lang: "en",
  countryState: "US-NY",
}

export const HEADERS_TOKENS: Record<string, string> = {
  app_name: "com.huami.midong",
  appname: "com.huami.midong",
  cv: "151689_9.12.5",
  v: "2.0",
  appplatform: "android_phone",
  vb: "202509151347",
  vn: "9.12.5",
  "user-agent": "Zepp/9.12.5 (Pixel 4; Android 12; Density/2.75)",
  "x-hm-ekv": "1",
  "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
  "accept-encoding": "gzip",
}

export const HEADERS_LOGIN: Record<string, string> = {
  app_name: "com.huami.webapp",
  appname: "com.huami.webapp",
  origin: "https://user.zepp.com",
  referer: "https://user.zepp.com/",
  "user-agent":
    "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0",
  "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
  accept: "application/json, text/plain, */*",
  "accept-language": "en-US,en;q=0.5",
}

export const HEADERS_DATA: Record<string, string> = {
  "hm-privacy-diagnostics": "false",
  country: "US",
  appplatform: "android_phone",
  "hm-privacy-ceip": "true",
  timezone: "Europe/London",
  channel: ZEPP_CHANNEL,
  vb: "202509151347",
  cv: "151689_9.12.5",
  appname: "com.huami.midong",
  v: "2.0",
  vn: "9.12.5",
  lang: "en_US",
  "user-agent": "Zepp/9.12.5 (Pixel 4; Android 12; Density/2.75)",
  "accept-encoding": "gzip",
}
