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

const nestedLearning = (): NonNullable<PortableVoiceModel['modelCard']['nestedLearning']> => ({
  frameworkVersion: 'nested-learning/1.0.0',
  targetPopulation: 'Chinese college students',
  currentModelStage: 'public-chinese-baseline',
  calibrationStatus: 'not-calibrated',
  caution: 'EATD baseline only; target-domain PHQ-9 calibration is still required.',
  layers: [
    { id: 'segment-features', name: '语音片段特征层', status: 'implemented', input: 'raw audio', output: 'features' },
    { id: 'task-representation', name: '任务级表示层', status: 'implemented', input: 'task features', output: 'task matrix' },
    { id: 'individual-risk-model', name: '个体筛查模型层', status: 'baseline-only', input: 'training matrix', output: 'research probability' },
    { id: 'target-domain-calibration', name: '中文大学生目标域适配层', status: 'requires-target-data', input: 'PHQ-9 target-domain data', output: 'calibrated threshold' },
    { id: 'continuous-validation', name: '持续评估更新层', status: 'planned', input: 'external cohorts', output: 'model card' },
  ],
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

  it('accepts nested-learning metadata and surfaces the current model stage', async () => {
    const modelFixture = portableModel()
    modelFixture.modelCard.nestedLearning = nestedLearning()
    const model = validatePortableVoiceModel(modelFixture)
    const result = await new PortableVoiceModelAdapter(model).predict(features)
    expect(model.modelCard.nestedLearning?.layers).toHaveLength(5)
    expect(result.explanation).toContain('公开中文基线')
    expect(result.explanation).toContain('尚未完成中文大学生目标域校准')
  })

  it('rejects models below the activation gate', () => {
    const model = portableModel()
    model.validation.rocAuc = 0.69
    expect(() => validatePortableVoiceModel(model)).toThrow('启用门槛')
  })

  it('rejects malformed nested-learning metadata', () => {
    const model = portableModel()
    model.modelCard.nestedLearning = {
      ...nestedLearning(),
      layers: nestedLearning().layers.slice(0, 4),
    }
    expect(() => validatePortableVoiceModel(model)).toThrow('层级不完整')
  })

  it('rejects prediction when an aligned research task is missing', async () => {
    const model = validatePortableVoiceModel(portableModel())
    await expect(new PortableVoiceModelAdapter(model).predict({ ...features, tasks: features.tasks.slice(0, 2) })).rejects.toThrow('缺少研究录音任务')
  })
})
