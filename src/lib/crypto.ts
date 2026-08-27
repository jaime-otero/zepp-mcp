export function pkcs7Pad(data: Uint8Array, blockSize: number = 16): Uint8Array {
  const padding = blockSize - (data.length % blockSize)
  const padded = new Uint8Array(data.length + padding)
  padded.set(data)
  padded.fill(padding, data.length)
  return padded
}

export async function aesCbcEncrypt(
  data: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array
): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "AES-CBC" },
    false,
    ["encrypt"]
  )
  const padded = pkcs7Pad(data)
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-CBC", iv },
    cryptoKey,
    padded
  )
  return new Uint8Array(encrypted)
}
