import { useEffect, useRef, useState } from 'react'

const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']

export function preferredRecordingMimeType(): string | undefined {
  if (typeof window.MediaRecorder?.isTypeSupported !== 'function') return undefined
  return MIME_TYPES.find((mimeType) => window.MediaRecorder.isTypeSupported(mimeType))
}

export function useRecorder() {
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<number | null>(null)
  const startedAtRef = useRef<number | null>(null)

  const supported = typeof navigator.mediaDevices?.getUserMedia === 'function' && typeof window.MediaRecorder === 'function'

  function clearTimer() {
    if (timerRef.current !== null) window.clearInterval(timerRef.current)
    timerRef.current = null
    startedAtRef.current = null
  }

  function stopTracks() {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }

  useEffect(() => () => {
    clearTimer()
    const recorder = recorderRef.current
    if (recorder?.state === 'recording') recorder.stop()
    stopTracks()
  }, [])

  async function start(): Promise<void> {
    if (!supported) throw new Error('当前浏览器不支持录音，请使用最新版 Chrome、Edge 或 Safari。')
    if (recorderRef.current?.state === 'recording') return
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    try {
      const mimeType = preferredRecordingMimeType()
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      chunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data)
      }
      recorder.start()
      streamRef.current = stream
      recorderRef.current = recorder
      startedAtRef.current = Date.now()
      setElapsed(0)
      setRecording(true)
      timerRef.current = window.setInterval(() => {
        if (startedAtRef.current !== null) setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000))
      }, 250)
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop())
      throw error
    }
  }

  async function stop(): Promise<Blob> {
    const recorder = recorderRef.current
    if (!recorder || recorder.state !== 'recording') throw new Error('录音尚未开始')
    clearTimer()
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        stopTracks()
        recorderRef.current = null
        setRecording(false)
      }
      recorder.onerror = () => {
        cleanup()
        reject(new Error('录音保存失败，请重新录制。'))
      }
      recorder.onstop = () => {
        const mimeType = recorder.mimeType || chunksRef.current.find((chunk) => chunk.type)?.type || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type: mimeType })
        cleanup()
        if (!blob.size) {
          reject(new Error('没有录到有效音频，请重新录制。'))
          return
        }
        resolve(blob)
      }
      recorder.stop()
    })
  }

  return { supported, recording, elapsed, start, stop }
}
