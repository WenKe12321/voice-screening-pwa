import { webcrypto } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { createVault, decryptJson, encryptJson, unlockVault } from '../src/lib/cryptoVault'

beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
})

describe('crypto vault', () => {
  it('encrypts and decrypts application data', async () => {
    const { key } = await createVault('a-long-local-passphrase')
    const payload = await encryptJson(key, { private: 'recording metadata' })
    expect(payload.ciphertext).not.toContain('recording metadata')
    await expect(decryptJson(key, payload)).resolves.toEqual({ private: 'recording metadata' })
  })

  it('unlocks with the original passphrase and rejects a wrong one', async () => {
    const { metadata } = await createVault('a-long-local-passphrase')
    await expect(unlockVault('a-long-local-passphrase', metadata)).resolves.toBeDefined()
    await expect(unlockVault('incorrect-password', metadata)).rejects.toThrow('访问口令不正确')
  })
})
