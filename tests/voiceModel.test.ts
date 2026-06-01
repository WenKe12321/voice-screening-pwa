import { describe, expect, it } from 'vitest'
import type { VoiceFeatures } from '../src/domain/types'
import { DemoVoiceModelAdapter } from '../src/lib/voiceModel'

const features: VoiceFeatures = {
  schemaVersion: 1,
  taskCount: 1,
  durationSeconds: 20,
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
  tasks: [],
}

describe('DemoVoiceModelAdapter', () => {
  it('returns a bounded and explicitly unvalidated demo index', async () => {
    const result = await new DemoVoiceModelAdapter().predict(features)
    expect(result.resultKind).toBe('demo-index')
    expect(result.demoIndex).toBeGreaterThanOrEqual(0)
    expect(result.demoIndex).toBeLessThanOrEqual(100)
    expect(result.label).toContain('未验证')
    expect(result.explanation).toContain('不参与 PHQ-9')
  })
})
