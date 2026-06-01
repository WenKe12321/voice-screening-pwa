import { describe, expect, it } from 'vitest'
import { aggregateVoiceFeatures, analyzeSamples } from '../src/lib/audioFeatures'

function sineWave(frequency: number, seconds: number, sampleRate = 8_000) {
  return Float32Array.from({ length: seconds * sampleRate }, (_, index) => Math.sin(2 * Math.PI * frequency * index / sampleRate) * 0.22)
}

describe('audio feature extraction', () => {
  it('extracts stable summaries from a voiced sample', () => {
    const features = analyzeSamples('voice', sineWave(180, 2), 8_000)
    expect(features.durationSeconds).toBe(2)
    expect(features.activeVoiceRatio).toBeGreaterThan(0.9)
    expect(features.pitchMedianHz).toBeGreaterThan(150)
    expect(features.pitchMedianHz).toBeLessThan(220)
    expect(features.mfccMean).toHaveLength(8)
  })

  it('aggregates multiple task summaries', () => {
    const first = analyzeSamples('first', sineWave(160, 1), 8_000)
    const second = analyzeSamples('second', sineWave(200, 1), 8_000)
    const summary = aggregateVoiceFeatures([first, second])
    expect(summary.taskCount).toBe(2)
    expect(summary.durationSeconds).toBe(2)
  })
})
