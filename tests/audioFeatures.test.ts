import { afterEach, describe, expect, it } from 'vitest'
import { aggregateVoiceFeatures, analyzeSamples, artifactFromBlob } from '../src/lib/audioFeatures'

const originalAudioContext = window.AudioContext

afterEach(() => {
  window.AudioContext = originalAudioContext
})

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

describe('Python/browser feature parity', () => {
  it('matches the deterministic Python reference within rounding tolerance', () => {
    const sampleRate = 16_000
    const samples = Float32Array.from({ length: sampleRate }, (_, index) => (
      index >= 4_000 && index < 6_000 ? 0 : 0.18 * Math.sin(2 * Math.PI * 180 * index / sampleRate)
    ))
    const features = analyzeSamples('parity-reference', samples, sampleRate)
    expect(features.durationSeconds).toBe(1)
    expect(features.activeVoiceRatio).toBeCloseTo(0.9333, 4)
    expect(features.pauseRatio).toBeCloseTo(0.0667, 4)
    expect(features.rmsMean).toBeCloseTo(0.1135, 4)
    expect(features.rmsStdDev).toBeCloseTo(0.0347, 4)
    expect(features.zeroCrossingRate).toBeCloseTo(0.0196, 4)
    expect(features.pitchMedianHz).toBeCloseTo(179.8, 1)
    expect(features.pitchRangeHz).toBeCloseTo(4.1, 1)
    expect(features.spectralCentroidHz).toBeCloseTo(757.9, 1)
    expect(features.speechRateProxy).toBeCloseTo(28, 2)
    expect(features.mfccMean).toEqual([-133.153, 52.832, -8.489, 34.897, -11.735, 26.686, -9.128, 19.009])
  })
})

describe('recorded blob decoding', () => {
  it('returns a helpful message when the browser cannot decode a recording', async () => {
    class RejectingAudioContext {
      decodeAudioData() {
        return Promise.reject(new DOMException('Unable to decode audio data'))
      }

      close() {
        return Promise.resolve()
      }
    }

    window.AudioContext = RejectingAudioContext as unknown as typeof AudioContext
    await expect(artifactFromBlob('voice', '录音', new Blob(['invalid-audio'], { type: 'audio/webm' })))
      .rejects.toThrow('无法读取这段录音，请重新录制')
  })
})
