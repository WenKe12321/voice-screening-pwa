import { useRef, useState } from 'react'

export function useRecorder() {
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<number | null>(null)

  const supported = typeof navigator.mediaDevices?.getUserMedia === 'function' && typeof window.MediaRecorder === 'function'

  async function start(): Promise<void> {
    if (!supported) throw new Error('当前浏览器不支持录音，请使用最新版 Chrome、Edge 或 Safari。')
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    const recorder = new MediaRecorder(stream)
    chunksRef.current = []
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunksRef.current.push(event.data)
    }
    recorder.start(500)
    streamRef.current = stream
    recorderRef.current = recorder
    setElapsed(0)
    setRecording(true)
    timerRef.current = window.setInterval(() => setElapsed((value) => value + 1), 1000)
  }

  async function stop(): Promise<Blob> {
    const recorder = recorderRef.current
    if (!recorder) throw new Error('录音尚未开始')
    return new Promise((resolve) => {
      recorder.onstop = () => {
        if (timerRef.current) window.clearInterval(timerRef.current)
        streamRef.current?.getTracks().forEach((track) => track.stop())
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        recorderRef.current = null
        streamRef.current = null
        setRecording(false)
        resolve(blob)
      }
      recorder.stop()
    })
  }

  return { supported, recording, elapsed, start, stop }
}
