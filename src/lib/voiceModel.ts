import type { VoiceFeatures, VoiceResearchResult } from '../domain/types'

export interface VoiceModelAdapter {
  version: string
  predict(features: VoiceFeatures): Promise<VoiceResearchResult>
}

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)))

export class DemoVoiceModelAdapter implements VoiceModelAdapter {
  version = 'demo-acoustic-index/1.0.0'

  async predict(features: VoiceFeatures): Promise<VoiceResearchResult> {
    const pauseSignal = features.pauseRatio * 38
    const energySignal = Math.max(0, 0.08 - features.rmsMean) * 260
    const pitchSignal = Math.max(0, 85 - features.pitchRangeHz) * 0.22
    const durationSignal = Math.min(14, features.durationSeconds / 16)
    const demoIndex = clamp(18 + pauseSignal + energySignal + pitchSignal + durationSignal)
    return {
      adapterVersion: this.version,
      demoIndex,
      label: '未验证语音研究演示指数',
      explanation: '该指数仅用于展示端侧特征提取和模型替换流程，未经临床验证，不参与 PHQ-9 风险等级判断。',
    }
  }
}
