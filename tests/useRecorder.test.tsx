import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { preferredRecordingMimeType, useRecorder } from '../src/hooks/useRecorder'

const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')
const originalMediaRecorder = Object.getOwnPropertyDescriptor(window, 'MediaRecorder')

class FakeMediaRecorder {
  static latest?: FakeMediaRecorder

  static isTypeSupported(mimeType: string) {
    return mimeType === 'audio/webm;codecs=opus'
  }

  state: RecordingState = 'inactive'
  mimeType: string
  ondataavailable: ((event: BlobEvent) => void) | null = null
  onstop: (() => void) | null = null
  onerror: (() => void) | null = null
  startArgument?: number

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    this.mimeType = options?.mimeType ?? ''
    FakeMediaRecorder.latest = this
  }

  start(timeslice?: number) {
    this.startArgument = timeslice
    this.state = 'recording'
  }

  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob(['complete-audio'], { type: this.mimeType }) } as BlobEvent)
    this.onstop?.()
  }
}

describe('useRecorder', () => {
  const track = { stop: vi.fn() }
  const stream = { getTracks: () => [track] } as unknown as MediaStream

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-01T00:00:00Z'))
    track.stop.mockClear()
    FakeMediaRecorder.latest = undefined
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    })
    Object.defineProperty(window, 'MediaRecorder', {
      configurable: true,
      value: FakeMediaRecorder,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    if (originalMediaDevices) Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices)
    else Reflect.deleteProperty(navigator, 'mediaDevices')
    if (originalMediaRecorder) Object.defineProperty(window, 'MediaRecorder', originalMediaRecorder)
    else Reflect.deleteProperty(window, 'MediaRecorder')
  })

  it('selects an Opus WebM container when supported', () => {
    expect(preferredRecordingMimeType()).toBe('audio/webm;codecs=opus')
  })

  it('records one complete container and calculates elapsed time from the clock', async () => {
    let recorder: ReturnType<typeof useRecorder> | undefined
    const container = document.createElement('div')
    const root = createRoot(container)

    function TestComponent() {
      recorder = useRecorder()
      return null
    }

    await act(async () => root.render(<TestComponent />))
    await act(async () => recorder?.start())

    expect(recorder?.recording).toBe(true)
    expect(FakeMediaRecorder.latest?.startArgument).toBeUndefined()

    act(() => {
      vi.setSystemTime(new Date('2026-06-01T00:00:03.400Z'))
      vi.advanceTimersByTime(250)
    })
    expect(recorder?.elapsed).toBe(3)

    let blob: Blob | undefined
    await act(async () => {
      blob = await recorder?.stop()
    })
    expect(blob?.type).toBe('audio/webm;codecs=opus')
    expect(await blob?.text()).toBe('complete-audio')
    expect(track.stop).toHaveBeenCalledOnce()

    act(() => {
      vi.setSystemTime(new Date('2026-06-01T00:00:08.400Z'))
      vi.advanceTimersByTime(5_000)
    })
    expect(recorder?.elapsed).toBe(3)
    await act(async () => root.unmount())
  })
})
