import type { EncryptedPayload, VaultMetadata } from '../domain/types'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const DEFAULT_ITERATIONS = 240_000
const VERIFIER = 'voice-screening-vault-ready'

function cryptoApi(): Crypto {
  if (!globalThis.crypto?.subtle) throw new Error('当前浏览器不支持 Web Crypto')
  return globalThis.crypto
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export async function deriveVaultKey(passphrase: string, saltBase64: string, iterations = DEFAULT_ITERATIONS): Promise<CryptoKey> {
  const material = await cryptoApi().subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return cryptoApi().subtle.deriveKey(
    { name: 'PBKDF2', salt: base64ToBytes(saltBase64), iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptJson<T>(key: CryptoKey, value: T): Promise<EncryptedPayload> {
  const iv = cryptoApi().getRandomValues(new Uint8Array(12))
  const encoded = encoder.encode(JSON.stringify(value))
  const ciphertext = await cryptoApi().subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded)
  return { iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) }
}

export async function decryptJson<T>(key: CryptoKey, payload: EncryptedPayload): Promise<T> {
  const plain = await cryptoApi().subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(payload.iv) },
    key,
    base64ToBytes(payload.ciphertext),
  )
  return JSON.parse(decoder.decode(plain)) as T
}

export async function createVault(passphrase: string): Promise<{ key: CryptoKey; metadata: VaultMetadata }> {
  if (passphrase.length < 8) throw new Error('访问口令至少需要 8 个字符')
  const salt = cryptoApi().getRandomValues(new Uint8Array(16))
  const saltBase64 = bytesToBase64(salt)
  const key = await deriveVaultKey(passphrase, saltBase64)
  return {
    key,
    metadata: {
      schemaVersion: 1,
      salt: saltBase64,
      iterations: DEFAULT_ITERATIONS,
      verifier: await encryptJson(key, { marker: VERIFIER }),
      createdAt: new Date().toISOString(),
    },
  }
}

export async function unlockVault(passphrase: string, metadata: VaultMetadata): Promise<CryptoKey> {
  try {
    const key = await deriveVaultKey(passphrase, metadata.salt, metadata.iterations)
    const verifier = await decryptJson<{ marker: string }>(key, metadata.verifier)
    if (verifier.marker !== VERIFIER) throw new Error('口令错误')
    return key
  } catch {
    throw new Error('访问口令不正确')
  }
}
