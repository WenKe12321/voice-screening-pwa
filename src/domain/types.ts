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
  resultKind: 'demo-index' | 'research-probability'
  demoIndex: number
  researchProbability?: number
  label: string
  explanation: string
}

export type ScreeningMode = 'standard' | 'eatd-research'

export interface PortableVoiceModel {
  format: 'voice-screening-portable-model'
  schemaVersion: 1
  algorithm: 'standardized-logistic-regression'
  extractorVersion: string
  taskIds: ['eatd-positive', 'eatd-neutral', 'eatd-negative']
  featureOrder: string[]
  scaler: { mean: number[]; scale: number[] }
  model: { coefficients: number[]; intercept: number; threshold: number }
  validation: { rocAuc: number; recall: number; specificity: number; f1: number }
  modelCard: {
    source: 'EATD-Corpus'
    intendedUse: 'academic-research-only'
    limitations: string[]
    nestedLearning?: NestedLearningFramework
  }
}

export interface NestedLearningLayer {
  id: 'segment-features' | 'task-representation' | 'individual-risk-model' | 'target-domain-calibration' | 'continuous-validation'
  name: string
  status: 'implemented' | 'baseline-only' | 'requires-target-data' | 'planned'
  input: string
  output: string
}

export interface NestedLearningFramework {
  frameworkVersion: 'nested-learning/1.0.0'
  targetPopulation: 'Chinese college students'
  currentModelStage: 'public-chinese-baseline' | 'target-domain-calibrated' | 'external-validated'
  calibrationStatus: 'not-calibrated' | 'calibrated'
  layers: NestedLearningLayer[]
  caution: string
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
  screeningMode?: ScreeningMode
  experienceMode?: 'quick' | 'presentation'
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
