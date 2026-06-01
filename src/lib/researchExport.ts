import type { ResearchExport, StoredSessionEnvelope, VaultMetadata } from '../domain/types'

export function createResearchExport(session: StoredSessionEnvelope, vaultMetadata: VaultMetadata): ResearchExport {
  return {
    format: 'voice-screening-research-package',
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    encryption: 'AES-GCM-256/PBKDF2-SHA-256',
    vaultMetadata,
    session,
    note: '本文件包含加密研究数据。请使用创建该本地保险箱时设置的访问口令解锁。',
  }
}

export function downloadResearchExport(session: StoredSessionEnvelope, vaultMetadata: VaultMetadata): void {
  const content = JSON.stringify(createResearchExport(session, vaultMetadata), null, 2)
  const blob = new Blob([content], { type: 'application/vnd.voice-screening+json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `voice-screening-${session.createdAt.slice(0, 10)}-${session.id.slice(0, 8)}.vscreen`
  anchor.click()
  URL.revokeObjectURL(url)
}
