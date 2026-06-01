import { describe, expect, it } from 'vitest'
import type { PortableVoiceModel, TaskFeatures, VoiceFeatures } from '../src/domain/types'
import { PORTABLE_MODEL_EXTRACTOR_VERSION, PORTABLE_MODEL_FEATURE_ORDER, PORTABLE_MODEL_TASK_IDS, PortableVoiceModelAdapter, validatePortableVoiceModel } from '../src/lib/portableVoiceModel'

const task = (taskId: string): TaskFeatures => ({
  taskId,
  durationSeconds: 10,
  activeVoiceRatio: 0.72,
  pauseRatio: 0.28,
  rmsMean: 0.05,
  rmsStdDev: 0.02,
  zeroCrossingRate: 0.1,
  pitchMedianHz: 170,
  pitchRangeHz: 90,
  spectralCentroidHz: 1200,
  mfccMean: Array(8).fill(0),
  speechRateProxy: 12,
})

const portableModel = (): PortableVoiceModel => ({
  format: 'voice-screening-portable-model',
  schemaVersion: 1,
  algorithm: 'standardized-logistic-regression',
  extractorVersion: PORTABLE_MODEL_EXTRACTOR_VERSION,
  taskIds: [...PORTABLE_MODEL_TASK_IDS],
  featureOrder: [...PORTABLE_MODEL_FEATURE_ORDER],
  scaler: { mean: Array(PORTABLE_MODEL_FEATURE_ORDER.length).fill(0), scale: Array(PORTABLE_MODEL_FEATURE_ORDER.length).fill(1) },
  model: { coefficients: Array(PORTABLE_MODEL_FEATURE_ORDER.length).fill(0), intercept: 0, threshold: 0.5 },
  validation: { rocAuc: 0.76, recall: 0.72, specificity: 0.7, f1: 0.71 },
  modelCard: { source: 'EATD-Corpus', intendedUse: 'academic-research-only', limitations: ['研究用途'] },
})

const features: VoiceFeatures = {
  schemaVersion: 1,
  taskCount: 3,
  durationSeconds: 30,
  activeVoiceRatio: 0.72,
  pauseRatio: 0.28,
  rmsMean: 0.05,
  rmsStdDev: 0.02,
  zeroCrossingRate: 0.1,
  pitchMedianHz: 170,
  pitchRangeHz: 90,
  spectralCentroidHz: 1200,
  mfccMean: Array(8).fill(0),
  speechRateProxy: 12,
  tasks: PORTABLE_MODEL_TASK_IDS.map(task),
}

describe('PortableVoiceModelAdapter', () => {
  it('accepts an eligible aligned model and emits a research probability', async () => {
    const model = validatePortableVoiceModel(portableModel())
    const result = await new PortableVoiceModelAdapter(model).predict(features)
    expect(result.resultKind).toBe('research-probability')
    expect(result.researchProbability).toBe(0.5)
    expect(result.label).toContain('SDS')
    expect(result.explanation).toContain('不构成临床诊断')
  })

  it('rejects models below the activation gate', () => {
    const model = portableModel()
    model.validation.rocAuc = 0.69
    expect(() => validatePortableVoiceModel(model)).toThrow('启用门槛')
  })

  it('rejects prediction when an aligned research task is missing', async () => {
    const model = validatePortableVoiceModel(portableModel())
    await expect(new PortableVoiceModelAdapter(model).predict({ ...features, tasks: features.tasks.slice(0, 2) })).rejects.toThrow('缺少研究录音任务')
  })
})
