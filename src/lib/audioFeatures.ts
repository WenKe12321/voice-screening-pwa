import type { RecordingArtifact, TaskFeatures, VoiceFeatures } from '../domain/types'
import { bytesToBase64 } from './cryptoVault'

const round = (value: number, digits = 4) => Number(value.toFixed(digits))
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
const stddev = (values: number[]) => {
  const average = mean(values)
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)))
}
const median = (values: number[]) => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function estimatePitch(frame: Float32Array, sampleRate: number): number {
  const minLag = Math.floor(sampleRate / 350)
  const maxLag = Math.min(Math.floor(sampleRate / 70), frame.length - 1)
  let bestLag = 0
  let bestCorrelation = 0
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let correlation = 0
    for (let index = 0; index < frame.length - lag; index += 2) correlation += frame[index] * frame[index + lag]
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation
      bestLag = lag
    }
  }
  return bestLag && bestCorrelation > 0.01 ? sampleRate / bestLag : 0
}

function spectralSummary(frame: Float32Array, sampleRate: number): { centroid: number; mfcc: number[] } {
  const fftSize = Math.min(256, frame.length)
  const bins = 24
  const magnitudes: number[] = []
  for (let bin = 0; bin < fftSize / 2; bin += 1) {
    let real = 0
    let imaginary = 0
    for (let index = 0; index < fftSize; index += 1) {
      const angle = (2 * Math.PI * bin * index) / fftSize
      real += frame[index] * Math.cos(angle)
      imaginary -= frame[index] * Math.sin(angle)
    }
    magnitudes.push(Math.sqrt(real ** 2 + imaginary ** 2))
  }
  const magnitudeSum = magnitudes.reduce((sum, value) => sum + value, 0) || 1
  const centroid = magnitudes.reduce((sum, value, bin) => sum + value * bin * sampleRate / fftSize, 0) / magnitudeSum
  const bandSize = Math.ceil(magnitudes.length / bins)
  const logBands = Array.from({ length: bins }, (_, index) => {
    const energy = magnitudes.slice(index * bandSize, (index + 1) * bandSize).reduce((sum, value) => sum + value ** 2, 0)
    return Math.log(energy + 1e-8)
  })
  const mfcc = Array.from({ length: 8 }, (_, coefficient) => (
    logBands.reduce((sum, value, index) => sum + value * Math.cos(Math.PI * coefficient * (index + 0.5) / bins), 0)
  ))
  return { centroid, mfcc }
}

export function analyzeSamples(taskId: string, samples: Float32Array, sampleRate: number): TaskFeatures {
  if (!samples.length || sampleRate <= 0) throw new Error('无法分析空录音')
  const frameSize = Math.min(1024, samples.length)
  const hop = Math.max(256, Math.floor(frameSize / 2))
  const frames: Float32Array[] = []
  for (let offset = 0; offset + frameSize <= samples.length; offset += hop) frames.push(samples.subarray(offset, offset + frameSize))
  if (!frames.length) frames.push(samples)
  const sampledFrames = frames.filter((_, index) => index % Math.max(1, Math.ceil(frames.length / 100)) === 0)
  const rmsValues = sampledFrames.map((frame) => Math.sqrt(mean(Array.from(frame, (value) => value ** 2))))
  const noiseFloor = Math.max(0.006, median(rmsValues) * 0.35)
  const activeFrames = sampledFrames.filter((_, index) => rmsValues[index] > noiseFloor)
  const activeVoiceRatio = activeFrames.length / sampledFrames.length
  const pitchValues = activeFrames.map((frame) => estimatePitch(frame, sampleRate)).filter(Boolean)
  const spectra = activeFrames.slice(0, 36).map((frame) => spectralSummary(frame, sampleRate))
  const zeroCrossingRate = mean(sampledFrames.map((frame) => {
    let crossings = 0
    for (let index = 1; index < frame.length; index += 1) {
      if ((frame[index - 1] >= 0) !== (frame[index] >= 0)) crossings += 1
    }
    return crossings / frame.length
  }))
  const mfccMean = Array.from({ length: 8 }, (_, index) => mean(spectra.map((spectrum) => spectrum.mfcc[index])))
  const pitchMin = pitchValues.length ? Math.min(...pitchValues) : 0
  const pitchMax = pitchValues.length ? Math.max(...pitchValues) : 0
  const durationSeconds = samples.length / sampleRate
  return {
    taskId,
    durationSeconds: round(durationSeconds, 2),
    activeVoiceRatio: round(activeVoiceRatio),
    pauseRatio: round(1 - activeVoiceRatio),
    rmsMean: round(mean(rmsValues)),
    rmsStdDev: round(stddev(rmsValues)),
    zeroCrossingRate: round(zeroCrossingRate),
    pitchMedianHz: round(median(pitchValues), 1),
    pitchRangeHz: round(pitchMax - pitchMin, 1),
    spectralCentroidHz: round(mean(spectra.map((spectrum) => spectrum.centroid)), 1),
    mfccMean: mfccMean.map((value) => round(value, 3)),
    speechRateProxy: round(activeFrames.length / Math.max(durationSeconds, 0.1), 2),
  }
}

export function aggregateVoiceFeatures(tasks: TaskFeatures[]): VoiceFeatures {
  if (!tasks.length) throw new Error('至少需要一段录音')
  const weighted = (field: keyof TaskFeatures) => {
    const total = tasks.reduce((sum, task) => sum + task.durationSeconds, 0) || 1
    return tasks.reduce((sum, task) => sum + Number(task[field]) * task.durationSeconds, 0) / total
  }
  const durationSeconds = tasks.reduce((sum, task) => sum + task.durationSeconds, 0)
  return {
    schemaVersion: 1,
    taskCount: tasks.length,
    durationSeconds: round(durationSeconds, 2),
    activeVoiceRatio: round(weighted('activeVoiceRatio')),
    pauseRatio: round(weighted('pauseRatio')),
    rmsMean: round(weighted('rmsMean')),
    rmsStdDev: round(weighted('rmsStdDev')),
    zeroCrossingRate: round(weighted('zeroCrossingRate')),
    pitchMedianHz: round(weighted('pitchMedianHz'), 1),
    pitchRangeHz: round(weighted('pitchRangeHz'), 1),
    spectralCentroidHz: round(weighted('spectralCentroidHz'), 1),
    speechRateProxy: round(weighted('speechRateProxy'), 2),
    mfccMean: Array.from({ length: 8 }, (_, index) => round(mean(tasks.map((task) => task.mfccMean[index] ?? 0)), 3)),
    tasks,
  }
}

export async function artifactFromBlob(taskId: string, label: string, blob: Blob): Promise<RecordingArtifact> {
  const AudioContextClass = window.AudioContext
  if (!AudioContextClass) throw new Error('当前浏览器不支持音频分析')
  const audioContext = new AudioContextClass()
  try {
    const buffer = await blob.arrayBuffer()
    if (!buffer.byteLength) throw new Error('没有录到有效音频，请重新录制。')
    let decoded: AudioBuffer
    try {
      decoded = await audioContext.decodeAudioData(buffer.slice(0))
    } catch {
      throw new Error('无法读取这段录音，请重新录制。建议至少录制 2 秒，并使用最新版 Chrome、Edge 或 Safari。')
    }
    const features = analyzeSamples(taskId, decoded.getChannelData(0), decoded.sampleRate)
    return { taskId, label, mimeType: blob.type || 'audio/webm', dataBase64: bytesToBase64(new Uint8Array(buffer)), features }
  } finally {
    await audioContext.close()
  }
}
