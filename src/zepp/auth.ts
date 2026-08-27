import { aesCbcEncrypt } from "../lib/crypto"
import {
  ZEPP_ENCRYPTION_KEY,
  ZEPP_ENCRYPTION_IV,
  URLS,
  TOKENS_PAYLOAD,
  LOGIN_PAYLOAD,
  HEADERS_TOKENS,
  HEADERS_LOGIN,
} from "./constants"
import type { ZeppTokenResult, ZeppLoginResult } from "./types"

function buildFormBody(params: Record<string, string | string[]>): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const v of value) {
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`)
      }
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    }
  }
  return parts.join("&")
}

export async function getAccessAndRefreshTokens(
  email: string,
  password: string
): Promise<ZeppTokenResult> {
  const payload: Record<string, string | string[]> = {
    ...TOKENS_PAYLOAD,
    emailOrPhone: email,
    password: password,
  }

  const formBody = buildFormBody(payload)
  const encoder = new TextEncoder()
  const encoded = encoder.encode(formBody)

  const encrypted = await aesCbcEncrypt(
    encoded,
    ZEPP_ENCRYPTION_KEY,
    ZEPP_ENCRYPTION_IV
  )

  const response = await fetch(URLS.TOKENS, {
    method: "POST",
    headers: HEADERS_TOKENS,
    body: encrypted,
    redirect: "manual",
  })

  if (response.status !== 303) {
    throw new Error(
      `Token request failed: status ${response.status} (expected 303)`
    )
  }

  const location = response.headers.get("location")
  if (!location) {
    throw new Error("No redirect location in token response")
  }

  const url = new URL(location)
  const accessToken = url.searchParams.get("access")
  const refreshToken = url.searchParams.get("refresh")

  if (!accessToken || !refreshToken) {
    throw new Error("Missing access or refresh token in redirect URL")
  }

  return { accessToken, refreshToken }
}

export async function login(accessToken: string): Promise<ZeppLoginResult> {
  const deviceId = crypto.randomUUID()

  const payload: Record<string, string> = {
    ...LOGIN_PAYLOAD,
    code: accessToken,
    device_id: deviceId,
  }

  const formBody = buildFormBody(payload)

  const response = await fetch(URLS.LOGIN, {
    method: "POST",
    headers: HEADERS_LOGIN,
    body: formBody,
  })

  if (response.status !== 200) {
    throw new Error(`Login request failed: status ${response.status}`)
  }

  const data = (await response.json()) as Record<string, unknown>
  const tokenInfo = data.token_info as Record<string, string> | undefined

  if (!tokenInfo) {
    throw new Error("No token_info in login response")
  }

  const appToken = tokenInfo.app_token
  const loginToken = tokenInfo.login_token
  const userId = tokenInfo.user_id

  if (!appToken || !loginToken || !userId) {
    throw new Error("Missing app_token, login_token, or user_id in login response")
  }

  return { appToken, loginToken, userId }
}

export async function fullLogin(
  email: string,
  password: string
): Promise<ZeppLoginResult> {
  const { accessToken } = await getAccessAndRefreshTokens(email, password)
  return login(accessToken)
}
