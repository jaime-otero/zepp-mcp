import type { ZeppCachedSession } from "../zepp/types"

const KV_KEY = "zepp_session"

export async function getCachedSession(
  kv: KVNamespace
): Promise<ZeppCachedSession | null> {
  const raw = await kv.get(KV_KEY, "json")
  if (!raw) return null
  return raw as ZeppCachedSession
}

export async function setCachedSession(
  kv: KVNamespace,
  session: ZeppCachedSession,
  // Long-lived: every fresh login is a new Zepp session, so only log in again
  // when the API rejects the token (401/403), not on a timer.
  ttlSeconds: number = 30 * 86400
): Promise<void> {
  await kv.put(KV_KEY, JSON.stringify(session), {
    expirationTtl: ttlSeconds,
  })
}

export async function invalidateSession(kv: KVNamespace): Promise<void> {
  await kv.delete(KV_KEY)
}
