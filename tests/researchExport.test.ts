import { webcrypto } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { createVault, decryptJson, encryptJson, unlockVault } from '../src/lib/cryptoVault'
import { createResearchExport } from '../src/lib/researchExport'

beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
})

describe('research export', () => {
  it('includes the non-secret metadata required for independent decryption', async () => {
    const passphrase = 'a-long-local-passphrase'
    const { key, metadata } = await createVault(passphrase)
    const session = {
      id: 'session-id',
      createdAt: '2026-06-01T00:00:00.000Z',
      payload: await encryptJson(key, { private: 'screening data' }),
    }
    const exported = createResearchExport(session, metadata)
    expect(exported.schemaVersion).toBe(2)
    expect(exported.vaultMetadata.salt).toBe(metadata.salt)
    expect(JSON.stringify(exported)).not.toContain('screening data')
    const unlocked = await unlockVault(passphrase, exported.vaultMetadata)
    await expect(decryptJson(unlocked, exported.session.payload)).resolves.toEqual({ private: 'screening data' })
  })
})
