import type { PortableVoiceModel, TaskFeatures, VoiceFeatures, VoiceResearchResult } from '../domain/types'
import type { VoiceModelAdapter } from './voiceModel'

export const PORTABLE_MODEL_EXTRACTOR_VERSION = 'browser-acoustic-features/1.0.0'
export const PORTABLE_MODEL_TASK_IDS = ['eatd-positive', 'eatd-neutral', 'eatd-negative'] as const

const BASE_FEATURES = [
  'durationSeconds',
  'activeVoiceRatio',
  'pauseRatio',
  'rmsMean',
  'rmsStdDev',
  'zeroCrossingRate',
  'pitchMedianHz',
  'pitchRangeHz',
  'spectralCentroidHz',
  'speechRateProxy',
  ...Array.from({ length: 8 }, (_, index) => `mfccMean.${index}`),
] as const

export const PORTABLE_MODEL_FEATURE_ORDER = PORTABLE_MODEL_TASK_IDS.flatMap((taskId) => (
  BASE_FEATURES.map((feature) => `${taskId}.${feature}`)
))

const sigmoid = (value: number) => 1 / (1 + Math.exp(-value))
const clampPercentage = (value: number) => Math.max(0, Math.min(100, Math.round(value * 100)))

function finiteArray(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every((item) => Number.isFinite(item))
}

export function validatePortableVoiceModel(value: unknown): PortableVoiceModel {
  if (!value || typeof value !== 'object') throw new Error('模型文件不是有效的 JSON 对象')
  const model = value as Partial<PortableVoiceModel>
  if (model.format !== 'voice-screening-portable-model' || model.schemaVersion !== 1) throw new Error('模型格式或结构版本不受支持')
  if (model.algorithm !== 'standardized-logistic-regression') throw new Error('仅支持标准化逻辑回归模型')
  if (model.extractorVersion !== PORTABLE_MODEL_EXTRACTOR_VERSION) throw new Error('模型特征提取器版本与当前应用不兼容')
  if (JSON.stringify(model.taskIds) !== JSON.stringify(PORTABLE_MODEL_TASK_IDS)) throw new Error('模型录音任务与研究采集模式不兼容')
  if (JSON.stringify(model.featureOrder) !== JSON.stringify(PORTABLE_MODEL_FEATURE_ORDER)) throw new Error('模型特征顺序与当前应用不兼容')
  const length = PORTABLE_MODEL_FEATURE_ORDER.length
  if (!model.scaler || !finiteArray(model.scaler.mean, length) || !finiteArray(model.scaler.scale, length) || model.scaler.scale.some((item) => item <= 0)) throw new Error('模型标准化参数无效')
  if (!model.model || !finiteArray(model.model.coefficients, length) || !Number.isFinite(model.model.intercept) || !Number.isFinite(model.model.threshold) || model.model.threshold < 0 || model.model.threshold > 1) throw new Error('模型权重或阈值无效')
  if (!model.validation || model.validation.rocAuc < 0.7 || model.validation.recall < 0.7) throw new Error('模型未达到研究模式启用门槛')
  if (model.modelCard?.source !== 'EATD-Corpus' || model.modelCard.intendedUse !== 'academic-research-only' || !Array.isArray(model.modelCard.limitations)) throw new Error('模型卡缺少学术研究用途说明')
  return model as PortableVoiceModel
}

function taskValue(task: TaskFeatures, feature: string): number {
  if (feature.startsWith('mfccMean.')) return task.mfccMean[Number(feature.slice('mfccMean.'.length))] ?? 0
  return Number(task[feature as keyof TaskFeatures])
}

export function flattenPortableFeatures(features: VoiceFeatures): number[] {
  const byId = new Map(features.tasks.map((task) => [task.taskId, task]))
  return PORTABLE_MODEL_FEATURE_ORDER.map((entry) => {
    const [taskId, ...rest] = entry.split('.')
    const task = byId.get(taskId)
    if (!task) throw new Error(`缺少研究录音任务：${taskId}`)
    return taskValue(task, rest.join('.'))
  })
}

export class PortableVoiceModelAdapter implements VoiceModelAdapter {
  version: string
  private readonly portableModel: PortableVoiceModel

  constructor(portableModel: PortableVoiceModel) {
    this.portableModel = portableModel
    this.version = `eatd-portable-logistic/${portableModel.schemaVersion}`
  }

  async predict(features: VoiceFeatures): Promise<VoiceResearchResult> {
    const values = flattenPortableFeatures(features)
    const standardized = values.map((value, index) => (value - this.portableModel.scaler.mean[index]) / this.portableModel.scaler.scale[index])
    const logit = standardized.reduce((sum, value, index) => sum + value * this.portableModel.model.coefficients[index], this.portableModel.model.intercept)
    const researchProbability = sigmoid(logit)
    return {
      adapterVersion: this.version,
      resultKind: 'research-probability',
      demoIndex: clampPercentage(researchProbability),
      researchProbability,
      label: 'SDS 标签语音研究概率',
      explanation: `该概率来自 EATD-Corpus SDS 自评标签研究模型，仅适用于对齐的研究采集问题。它不等同于 PHQ-9 风险等级，不构成临床诊断。验证集 ROC-AUC ${this.portableModel.validation.rocAuc.toFixed(2)}，召回率 ${this.portableModel.validation.recall.toFixed(2)}。`,
    }
  }
}
