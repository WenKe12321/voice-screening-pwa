export type PhqAnswer = 0 | 1 | 2 | 3

export interface PhqResult {
  total: number
  level: 'minimal' | 'mild' | 'moderate' | 'moderately-severe' | 'severe'
  label: string
  recommendation: string
  urgentSupport: boolean
}

export interface TaskFeatures {
  taskId: string
  durationSeconds: number
  activeVoiceRatio: number
  pauseRatio: number
  rmsMean: number
  rmsStdDev: number
  zeroCrossingRate: number
  pitchMedianHz: number
  pitchRangeHz: number
  spectralCentroidHz: number
  mfccMean: number[]
  speechRateProxy: number
}

export interface VoiceFeatures {
  schemaVersion: 1
  taskCount: number
  durationSeconds: number
  activeVoiceRatio: number
  pauseRatio: number
  rmsMean: number
  rmsStdDev: number
  zeroCrossingRate: number
  pitchMedianHz: number
  pitchRangeHz: number
  spectralCentroidHz: number
  mfccMean: number[]
  speechRateProxy: number
  tasks: TaskFeatures[]
}

export interface VoiceResearchResult {
  adapterVersion: string
  demoIndex: number
  label: string
  explanation: string
}

export interface RecordingArtifact {
  taskId: string
  label: string
  mimeType: string
  dataBase64: string
  features: TaskFeatures
}

export interface ScreeningSession {
  id: string
  createdAt: string
  anonymousResearchId: string
  phqAnswers: PhqAnswer[]
  phqResult: PhqResult
  voiceFeatures: VoiceFeatures
  voiceResearchResult: VoiceResearchResult
  recordings: RecordingArtifact[]
}

export interface EncryptedPayload {
  iv: string
  ciphertext: string
}

export interface VaultMetadata {
  schemaVersion: 1
  salt: string
  iterations: number
  verifier: EncryptedPayload
  createdAt: string
}

export interface StoredSessionEnvelope {
  id: string
  createdAt: string
  payload: EncryptedPayload
}

export interface ResearchExport {
  format: 'voice-screening-research-package'
  schemaVersion: 2
  exportedAt: string
  encryption: 'AES-GCM-256/PBKDF2-SHA-256'
  vaultMetadata: VaultMetadata
  session: StoredSessionEnvelope
  note: string
}
