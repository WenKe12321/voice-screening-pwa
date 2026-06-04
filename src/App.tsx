import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { PHQ9_OPTIONS, PHQ9_QUESTIONS, scorePhq9 } from './domain/phq9'
import { EATD_RESEARCH_TASKS, STANDARD_RECORDING_TASKS } from './domain/recordingTasks'
import type { PhqAnswer, PortableVoiceModel, RecordingArtifact, ScreeningMode, ScreeningSession, StoredSessionEnvelope, TaskFeatures, VaultMetadata, VoiceFeatures } from './domain/types'
import { useRecorder } from './hooks/useRecorder'
import { aggregateVoiceFeatures, artifactFromBlob } from './lib/audioFeatures'
import { createVault, decryptJson, encryptJson, unlockVault } from './lib/cryptoVault'
import { clearVault, deletePortableVoiceModel, deleteSession, listSessionEnvelopes, loadPortableVoiceModel, loadVaultMetadata, savePortableVoiceModel, saveSession, saveVaultMetadata } from './lib/db'
import { PortableVoiceModelAdapter, validatePortableVoiceModel } from './lib/portableVoiceModel'
import { downloadResearchExport } from './lib/researchExport'
import { DemoVoiceModelAdapter } from './lib/voiceModel'

type Screen = 'welcome' | 'presentation' | 'consent' | 'vault' | 'questionnaire' | 'recording' | 'analyzing' | 'result' | 'history' | 'settings'
type PrivateScreen = 'questionnaire' | 'history' | 'settings'
type RunMode = 'saved' | 'quick' | 'demo'

interface LocalDataStats {
  sessionCount: number
  recordingCount: number
  latestAt?: string
  estimatedUsageBytes?: number
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const APP_URL = 'https://wenke12321.github.io/voice-screening-pwa/'

const TASK_DURATION_SECONDS: Record<string, { range: string; estimate: number }> = {
  'neutral-words': { range: '15-30 秒', estimate: 30 },
  'north-wind': { range: '1-2 分钟', estimate: 90 },
  'open-routine': { range: '30-60 秒', estimate: 60 },
  'open-support': { range: '30-60 秒', estimate: 60 },
  'eatd-positive': { range: '30-60 秒', estimate: 60 },
  'eatd-neutral': { range: '30-60 秒', estimate: 60 },
  'eatd-negative': { range: '30-60 秒', estimate: 60 },
}

const formatDate = (value: string) => new Intl.DateTimeFormat('zh-CN', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
}).format(new Date(value))

const formatMinutes = (seconds: number) => `${Math.max(1, Math.ceil(seconds / 60))} 分钟`
const formatBytes = (value?: number) => {
  if (!value) return '约 0 B'
  if (value < 1024 * 1024) return `约 ${Math.max(1, Math.round(value / 1024))} KB`
  return `约 ${(value / 1024 / 1024).toFixed(1)} MB`
}

function modelStatusText(portableModel?: PortableVoiceModel) {
  if (!portableModel) {
    return {
      title: '当前语音模型：演示模式',
      body: '普通自测会显示未验证演示指数；它不参与 PHQ-9 风险等级，也不代表医学判断。',
    }
  }
  return {
    title: '当前语音模型：EATD 研究模式',
    body: `已导入 EATD-Corpus 研究模型，仅在研究采集模式中显示 SDS 标签研究概率。验证集 ROC-AUC ${portableModel.validation.rocAuc.toFixed(2)}，召回率 ${portableModel.validation.recall.toFixed(2)}。`,
  }
}

function createPresentationTaskFeatures(taskId: string, label: string, durationSeconds: number, activeVoiceRatio: number, pauseRatio: number, pitchMedianHz: number): TaskFeatures {
  return {
    taskId,
    durationSeconds,
    activeVoiceRatio,
    pauseRatio,
    rmsMean: 0.047,
    rmsStdDev: 0.018,
    zeroCrossingRate: 0.076,
    pitchMedianHz,
    pitchRangeHz: 92,
    spectralCentroidHz: 1420,
    mfccMean: [-18.4, 4.2, -2.1, 1.8, -0.9, 0.7, -0.4, 0.2],
    speechRateProxy: label.length / Math.max(1, durationSeconds),
  }
}

function createPresentationSession(): ScreeningSession {
  const phqAnswers: PhqAnswer[] = [1, 1, 1, 1, 1, 0, 0, 0, 0]
  const taskFeatures = [
    createPresentationTaskFeatures('neutral-words', '十个中性词', 24, 0.74, 0.26, 178),
    createPresentationTaskFeatures('north-wind', '北风与太阳朗读', 78, 0.69, 0.31, 172),
    createPresentationTaskFeatures('open-routine', '日常节奏回答', 42, 0.63, 0.37, 169),
    createPresentationTaskFeatures('open-support', '支持事件回答', 39, 0.66, 0.34, 171),
  ]
  const voiceFeatures: VoiceFeatures = {
    schemaVersion: 1,
    taskCount: taskFeatures.length,
    durationSeconds: taskFeatures.reduce((sum, task) => sum + task.durationSeconds, 0),
    activeVoiceRatio: 0.68,
    pauseRatio: 0.32,
    rmsMean: 0.047,
    rmsStdDev: 0.018,
    zeroCrossingRate: 0.076,
    pitchMedianHz: 172,
    pitchRangeHz: 92,
    spectralCentroidHz: 1420,
    mfccMean: [-18.4, 4.2, -2.1, 1.8, -0.9, 0.7, -0.4, 0.2],
    speechRateProxy: 0.31,
    tasks: taskFeatures,
  }
  return {
    id: 'presentation-demo-session',
    createdAt: new Date().toISOString(),
    screeningMode: 'standard',
    experienceMode: 'presentation',
    anonymousResearchId: 'DEFENSE-DEMO',
    phqAnswers,
    phqResult: scorePhq9(phqAnswers),
    voiceFeatures,
    voiceResearchResult: {
      adapterVersion: 'presentation-demo/1.0.0',
      resultKind: 'demo-index',
      demoIndex: 42,
      label: '答辩展示模拟语音指数',
      explanation: '这是一组模拟数据，仅用于展示交互、结果页和隐私边界，不来自真实用户，也不是训练模型输出。',
    },
    recordings: [],
  }
}

function SupportCard({ urgent = false }: { urgent?: boolean }) {
  return (
    <aside className={`support-card ${urgent ? 'urgent' : ''}`} aria-label="心理支持资源">
      <p className="eyebrow">{urgent ? '请优先照顾当下的安全' : '需要有人聊聊时'}</p>
      <h3>{urgent ? '你不必独自面对这一刻' : '支持一直在这里'}</h3>
      <p>{urgent ? '如果你正考虑伤害自己，请立即联系身边可信任的人，并拨打心理援助热线或紧急服务。' : '如果近期情绪持续困扰你，可以主动联系专业人员。'}</p>
      <div className="support-actions">
        <a href="tel:12356">心理援助热线 12356</a>
        {urgent && <a href="tel:120">紧急医疗 120</a>}
        {urgent && <a href="tel:110">紧急求助 110</a>}
      </div>
    </aside>
  )
}

function App() {
  const [screen, setScreen] = useState<Screen>('welcome')
  const [vaultMetadata, setVaultMetadata] = useState<VaultMetadata>()
  const [vaultKey, setVaultKey] = useState<CryptoKey>()
  const [unlockTarget, setUnlockTarget] = useState<PrivateScreen>('questionnaire')
  const [loading, setLoading] = useState(true)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent>()
  const [online, setOnline] = useState(navigator.onLine)
  const [answers, setAnswers] = useState<(PhqAnswer | undefined)[]>(Array(9).fill(undefined))
  const [questionIndex, setQuestionIndex] = useState(0)
  const [recordings, setRecordings] = useState<RecordingArtifact[]>([])
  const [recordingIndex, setRecordingIndex] = useState(0)
  const [screeningMode, setScreeningMode] = useState<ScreeningMode>('standard')
  const [runMode, setRunMode] = useState<RunMode>('saved')
  const [portableModel, setPortableModel] = useState<PortableVoiceModel>()
  const [currentSession, setCurrentSession] = useState<ScreeningSession>()
  const [anonymousResearchId, setAnonymousResearchId] = useState('')
  const [history, setHistory] = useState<ScreeningSession[]>([])
  const [historyEnvelopes, setHistoryEnvelopes] = useState<Record<string, StoredSessionEnvelope>>({})
  const [localStats, setLocalStats] = useState<LocalDataStats>({ sessionCount: 0, recordingCount: 0 })
  const [error, setError] = useState('')
  const [processingRecording, setProcessingRecording] = useState(false)
  const recorder = useRecorder()
  const recordingTasks = screeningMode === 'eatd-research' ? EATD_RESEARCH_TASKS : STANDARD_RECORDING_TASKS
  const voiceModel = useMemo(() => screeningMode === 'eatd-research' && portableModel ? new PortableVoiceModelAdapter(portableModel) : new DemoVoiceModelAdapter(), [portableModel, screeningMode])

  useEffect(() => {
    Promise.all([loadVaultMetadata(), loadPortableVoiceModel()]).then(([metadata, model]) => {
      setVaultMetadata(metadata)
      setPortableModel(model)
    }).finally(() => setLoading(false))
    const onInstall = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)
    }
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener('beforeinstallprompt', onInstall)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('beforeinstallprompt', onInstall)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  useEffect(() => {
    if (screen === 'history' && vaultKey) void refreshHistory(vaultKey)
    if (screen === 'settings' && vaultKey) void refreshLocalStats(vaultKey)
  }, [screen, vaultKey])

  async function refreshHistory(key: CryptoKey) {
    const envelopes = await listSessionEnvelopes()
    const unlocked = await Promise.all(envelopes.map((envelope) => decryptJson<ScreeningSession>(key, envelope.payload)))
    setHistory(unlocked.sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
    setHistoryEnvelopes(Object.fromEntries(envelopes.map((envelope) => [envelope.id, envelope])))
  }

  async function refreshLocalStats(key: CryptoKey) {
    const envelopes = await listSessionEnvelopes()
    const sessions = await Promise.all(envelopes.map((envelope) => decryptJson<ScreeningSession>(key, envelope.payload)))
    const storage = navigator.storage?.estimate ? await navigator.storage.estimate() : {}
    setLocalStats({
      sessionCount: sessions.length,
      recordingCount: sessions.reduce((sum, session) => sum + session.recordings.length, 0),
      latestAt: sessions.map((session) => session.createdAt).sort().at(-1),
      estimatedUsageBytes: storage.usage,
    })
  }

  function goHome() {
    setRunMode('saved')
    setScreen('welcome')
  }

  function openPrivate(target: PrivateScreen) {
    if (!vaultKey) {
      setUnlockTarget(target)
      setScreen('vault')
      return
    }
    setScreen(target)
  }

  function prepareScreening(nextRunMode: RunMode) {
    setRunMode(nextRunMode)
    setScreen('consent')
  }

  function startPresentationDemo() {
    setRunMode('demo')
    setCurrentSession(createPresentationSession())
    setScreen('result')
  }

  function beginScreening(mode: ScreeningMode = 'standard', requestedRunMode: RunMode = runMode) {
    const effectiveRunMode = mode === 'eatd-research' ? 'saved' : requestedRunMode
    setRunMode(effectiveRunMode)
    setScreeningMode(mode)
    setAnswers(Array(9).fill(undefined))
    setQuestionIndex(0)
    setRecordings([])
    setRecordingIndex(0)
    setCurrentSession(undefined)
    setAnonymousResearchId('')
    if (effectiveRunMode === 'quick') {
      setScreen('questionnaire')
      return
    }
    openPrivate('questionnaire')
  }

  function setQuestionAnswer(value: PhqAnswer) {
    const next = [...answers]
    next[questionIndex] = value
    setAnswers(next)
    if (questionIndex === 8) {
      setScreen('recording')
      return
    }
    setQuestionIndex((index) => index + 1)
  }

  async function stopRecording() {
    setError('')
    setProcessingRecording(true)
    try {
      const blob = await recorder.stop()
      if (blob.size < 1024) throw new Error('录音时间太短，请重新录制。')
      const task = recordingTasks[recordingIndex]
      const artifact = await artifactFromBlob(task.id, task.title, blob)
      const nextRecordings = [...recordings, artifact]
      setRecordings(nextRecordings)
      if (recordingIndex < recordingTasks.length - 1) {
        setRecordingIndex((index) => index + 1)
      } else {
        await finalizeScreening(nextRecordings)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '录音分析失败，请重新尝试。')
    } finally {
      setProcessingRecording(false)
    }
  }

  async function finalizeScreening(artifacts: RecordingArtifact[]) {
    setScreen('analyzing')
    const phqAnswers = answers as PhqAnswer[]
    const phqResult = scorePhq9(phqAnswers)
    const voiceFeatures = aggregateVoiceFeatures(artifacts.map((artifact) => artifact.features))
    const voiceResearchResult = await voiceModel.predict(voiceFeatures)
    const session: ScreeningSession = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      screeningMode,
      experienceMode: runMode === 'quick' ? 'quick' : undefined,
      anonymousResearchId: anonymousResearchId.trim(),
      phqAnswers,
      phqResult,
      voiceFeatures,
      voiceResearchResult,
      recordings: artifacts,
    }
    if (runMode === 'quick') {
      setCurrentSession(session)
      setScreen('result')
      return
    }
    if (!vaultKey) throw new Error('本地保险箱尚未解锁')
    const envelope = { id: session.id, createdAt: session.createdAt, payload: await encryptJson(vaultKey, session) }
    await saveSession(envelope)
    setCurrentSession(session)
    setScreen('result')
  }

  async function removeHistory(id: string) {
    if (!window.confirm('确认删除这条本地筛查记录和录音吗？此操作无法撤销。')) return
    await deleteSession(id)
    if (vaultKey) await refreshHistory(vaultKey)
  }

  async function wipeVault() {
    if (!window.confirm('确认清空本地保险箱吗？全部录音和筛查记录都会永久删除。')) return
    await clearVault()
    setVaultMetadata(undefined)
    setVaultKey(undefined)
    setHistory([])
    setHistoryEnvelopes({})
    setLocalStats({ sessionCount: 0, recordingCount: 0 })
    setPortableModel(undefined)
    setScreen('welcome')
  }

  async function importPortableModel(file: File) {
    const model = validatePortableVoiceModel(JSON.parse(await file.text()))
    await savePortableVoiceModel(model)
    setPortableModel(model)
  }

  async function removePortableModel() {
    await deletePortableVoiceModel()
    setPortableModel(undefined)
  }

  async function exportAllEncrypted() {
    if (!vaultMetadata) return
    const envelopes = await listSessionEnvelopes()
    const bundle = {
      format: 'voice-screening-encrypted-research-package-bundle',
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      encryption: 'AES-GCM-256/PBKDF2-SHA-256',
      vaultMetadata,
      sessions: envelopes,
      note: 'All sessions remain encrypted. Decrypt only with the original vault passphrase.',
    }
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `voice-screening-all-${new Date().toISOString().slice(0, 10)}.vscreen-bundle.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  async function installApp() {
    if (!installPrompt) return
    await installPrompt.prompt()
    await installPrompt.userChoice
    setInstallPrompt(undefined)
  }

  if (loading) return <main className="shell centered"><p>正在打开本地应用...</p></main>

  return (
    <main className="shell">
      <header className="topbar">
        <button className="brand" onClick={goHome} aria-label="返回首页">
          <span className="brand-mark">声</span>
          <span><strong>心声自测</strong><small>本地研究原型</small></span>
        </button>
        <span className={`network ${online ? '' : 'offline'}`}>{online ? '本地模式' : '离线可用'}</span>
      </header>

      {screen === 'welcome' && (
        <section className="page welcome">
          <div className="hero-art" aria-hidden="true"><i /><i /><i /><i /><i /></div>
          <p className="eyebrow">A QUIET CHECK-IN · 给自己一点时间</p>
          <h1>听见心情的<br /><em>细微变化</em></h1>
          <p className="lead">一份在手机本地完成的心理健康辅助筛查。录音、问卷与分析结果默认加密保存在你的设备中，不会自动上传。</p>
          <div className="notice"><strong>研究原型</strong><span>本应用不能诊断抑郁症，也不能替代医生或心理咨询师。</span></div>
          <UsageGuide compact installPrompt={Boolean(installPrompt)} onInstall={() => void installApp()} />
          <div className="home-actions">
            <button className="primary wide" onClick={() => prepareScreening('saved')}>开始正式自测</button>
            <button className="secondary-action wide" type="button" onClick={() => prepareScreening('quick')}>快速体验模式</button>
            <button className="secondary-action wide" type="button" onClick={() => setScreen('presentation')}>答辩展示模式</button>
          </div>
          <div className="secondary-row">
            <button className="text-button" onClick={() => openPrivate('history')}>查看本地记录</button>
            <button className="text-button" onClick={() => openPrivate('settings')}>隐私与设置</button>
          </div>
          {installPrompt && <button className="install-tip" onClick={installApp}>添加到手机主屏幕</button>}
        </section>
      )}

      {screen === 'presentation' && <PresentationScreen onBack={goHome} onDemo={startPresentationDemo} />}
      {screen === 'consent' && <ConsentScreen quick={runMode === 'quick'} onBack={goHome} onContinue={() => beginScreening('standard')} />}

      {screen === 'vault' && (
        <VaultScreen
          metadata={vaultMetadata}
          onBack={goHome}
          onReady={(key, metadata) => {
            setVaultKey(key)
            if (metadata) setVaultMetadata(metadata)
            setScreen(unlockTarget)
          }}
        />
      )}

      {screen === 'questionnaire' && (
        <QuestionnaireScreen
          answers={answers}
          index={questionIndex}
          anonymousResearchId={anonymousResearchId}
          onResearchId={setAnonymousResearchId}
          onBack={() => questionIndex ? setQuestionIndex((index) => index - 1) : goHome()}
          onAnswer={setQuestionAnswer}
        />
      )}

      {screen === 'recording' && (
        <RecordingScreen
          index={recordingIndex}
          tasks={recordingTasks}
          completed={recordings.length}
          supported={recorder.supported}
          recording={recorder.recording}
          processing={processingRecording}
          elapsed={recorder.elapsed}
          error={error}
          onStart={() => {
            setError('')
            recorder.start().catch((caught) => setError(caught instanceof Error ? caught.message : '无法启动录音'))
          }}
          onStop={() => void stopRecording()}
          onBack={() => recordingIndex ? setRecordingIndex((index) => index - 1) : setScreen('questionnaire')}
        />
      )}

      {screen === 'analyzing' && <AnalyzingScreen />}
      {screen === 'result' && currentSession && <ResultScreen session={currentSession} onHome={goHome} onHistory={() => openPrivate('history')} />}
      {screen === 'history' && <HistoryScreen sessions={history} envelopes={historyEnvelopes} vaultMetadata={vaultMetadata} onBack={goHome} onDelete={(id) => void removeHistory(id)} />}
      {screen === 'settings' && <SettingsScreen portableModel={portableModel} localStats={localStats} onBack={goHome} onWipe={() => void wipeVault()} onExportAll={() => void exportAllEncrypted()} onImportModel={importPortableModel} onRemoveModel={() => void removePortableModel()} onBeginResearch={() => beginScreening('eatd-research', 'saved')} installPrompt={Boolean(installPrompt)} onInstall={() => void installApp()} />}

      {screen !== 'welcome' && screen !== 'analyzing' && (
        <footer className="privacy-footer">{runMode === 'quick' ? '快速体验 · 不保存数据 · ' : runMode === 'demo' ? '答辩展示 · 模拟数据 · ' : ''}仅本地处理 · 录音不会自动上传 · 非医疗诊断工具</footer>
      )}
    </main>
  )
}

function PresentationScreen({ onBack, onDemo }: { onBack: () => void; onDemo: () => void }) {
  return (
    <section className="page">
      <button className="back" onClick={onBack}>返回</button>
      <p className="eyebrow">答辩展示模式</p>
      <h2>不用录音，也能展示完整结果页</h2>
      <p className="muted">这个模式为现场汇报准备：使用一组内置模拟数据，跳过麦克风权限、保险箱和保存流程，直接展示 PHQ-9 结果、语音特征概览、求助资源与隐私边界。</p>
      <div className="demo-grid">
        <article><strong>不采集真人数据</strong><span>不会请求麦克风，也不会生成录音文件。</span></article>
        <article><strong>不写入本地保险箱</strong><span>返回首页后展示结果即消失，不进入历史记录。</span></article>
        <article><strong>不声称模型准确率</strong><span>语音指数为模拟值，只用于解释界面和研究路线。</span></article>
      </div>
      <button className="primary wide" onClick={onDemo}>查看模拟结果</button>
    </section>
  )
}

function ConsentScreen({ quick, onBack, onContinue }: { quick: boolean; onBack: () => void; onContinue: () => void }) {
  const [checks, setChecks] = useState([false, false, false])
  const toggle = (index: number) => setChecks((values) => values.map((value, position) => position === index ? !value : value))
  return (
    <section className="page">
      <button className="back" onClick={onBack}>返回</button>
      <p className="eyebrow">{quick ? '快速体验 · 不保存数据' : '开始之前'}</p>
      <h2>{quick ? '先体验完整流程' : '由你掌控的本地自测'}</h2>
      <p className="muted">{quick ? '这次体验不会创建保险箱，也不会保存录音、问卷或结果。关闭或返回首页后，数据会消失。' : '请确认你理解以下内容。你可以随时退出，也可以在设置中删除全部数据。'}</p>
      <div className="consent-list">
        {(quick ? [
          ['辅助筛查，不是诊断', '体验结果只帮助你了解流程，不能作为医学诊断或治疗依据。'],
          ['不会保存本次数据', '录音、问卷和分析结果只保留在本次页面状态中，不写入本地保险箱。'],
          ['正式使用请创建保险箱', '如果你想保留记录或导出研究包，请返回首页选择正式自测。'],
        ] : [
          ['辅助筛查，不是诊断', '结果用于帮助你关注近期状态，不能作为医学诊断或治疗依据。'],
          ['敏感数据留在设备中', '录音、问卷和分析结果会加密保存在当前浏览器，不会自动上传。'],
          ['口令无法找回', '保险箱口令不会上传或存储。忘记口令后，只能清空本地数据重新开始。'],
        ]).map(([title, copy], index) => (
          <label className="check-card" key={title}>
            <input type="checkbox" checked={checks[index]} onChange={() => toggle(index)} />
            <span><strong>{title}</strong><small>{copy}</small></span>
          </label>
        ))}
      </div>
      <button className="primary wide" disabled={!checks.every(Boolean)} onClick={onContinue}>我已理解并继续</button>
    </section>
  )
}

function VaultScreen({ metadata, onBack, onReady }: { metadata?: VaultMetadata; onBack: () => void; onReady: (key: CryptoKey, metadata?: VaultMetadata) => void }) {
  const [passphrase, setPassphrase] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)
  const creating = !metadata
  async function submit() {
    setWorking(true)
    setError('')
    try {
      if (creating) {
        if (passphrase !== repeat) throw new Error('两次输入的口令不一致')
        const created = await createVault(passphrase)
        await saveVaultMetadata(created.metadata)
        onReady(created.key, created.metadata)
      } else {
        onReady(await unlockVault(passphrase, metadata))
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '保险箱操作失败')
    } finally {
      setWorking(false)
    }
  }
  return (
    <section className="page">
      <button className="back" onClick={onBack}>返回</button>
      <p className="eyebrow">{creating ? '创建本地保险箱' : '解锁本地保险箱'}</p>
      <h2>{creating ? '先为数据加一把锁' : '欢迎回来'}</h2>
      <p className="muted">{creating ? '请设置至少 8 个字符的访问口令。录音与结果写入浏览器前会先加密。' : '输入访问口令以继续。口令只在本次打开应用期间使用。'}</p>
      <label className="field"><span>访问口令</span><input type="password" autoComplete={creating ? 'new-password' : 'current-password'} value={passphrase} onChange={(event) => setPassphrase(event.target.value)} /></label>
      {creating && <label className="field"><span>再次输入</span><input type="password" autoComplete="new-password" value={repeat} onChange={(event) => setRepeat(event.target.value)} /></label>}
      {error && <p className="error">{error}</p>}
      <button className="primary wide" onClick={() => void submit()} disabled={working || passphrase.length < 8}>{working ? '正在处理...' : creating ? '创建并继续' : '解锁并继续'}</button>
    </section>
  )
}

function QuestionnaireScreen({ answers, index, anonymousResearchId, onResearchId, onBack, onAnswer }: {
  answers: (PhqAnswer | undefined)[]
  index: number
  anonymousResearchId: string
  onResearchId: (value: string) => void
  onBack: () => void
  onAnswer: (value: PhqAnswer) => void
}) {
  return (
    <section className="page">
      <button className="back" onClick={onBack}>返回</button>
      <p className="eyebrow">PHQ-9 · 最近两周</p>
      <div className="progress"><span style={{ width: `${(index + 1) / 9 * 100}%` }} /></div>
      <p className="step-count">{String(index + 1).padStart(2, '0')} / 09</p>
      <h2 className="question">{PHQ9_QUESTIONS[index]}</h2>
      <p className="muted">请选择最接近你近期感受的选项。</p>
      <div className="option-list">
        {PHQ9_OPTIONS.map((option) => (
          <button className={`option ${answers[index] === option.value ? 'selected' : ''}`} key={option.value} onClick={() => onAnswer(option.value)}>
            <span>{option.value}</span>{option.label}
          </button>
        ))}
      </div>
      {index === 0 && <label className="field compact"><span>匿名研究编号（选填）</span><input value={anonymousResearchId} onChange={(event) => onResearchId(event.target.value)} placeholder="例如：PILOT-001" maxLength={40} /></label>}
    </section>
  )
}

function RecordingScreen({ index, completed, tasks, supported, recording, processing, elapsed, error, onStart, onStop, onBack }: {
  index: number
  completed: number
  tasks: typeof STANDARD_RECORDING_TASKS
  supported: boolean
  recording: boolean
  processing: boolean
  elapsed: number
  error: string
  onStart: () => void
  onStop: () => void
  onBack: () => void
}) {
  const task = tasks[index]
  const elapsedLabel = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`
  const duration = TASK_DURATION_SECONDS[task.id] ?? { range: '30-60 秒', estimate: 60 }
  const estimatedRemaining = tasks.slice(index).reduce((sum, item) => sum + (TASK_DURATION_SECONDS[item.id]?.estimate ?? 60), 0)
  return (
    <section className="page recording-page">
      <button className="back" onClick={onBack} disabled={recording || processing}>返回</button>
      <p className="eyebrow">{task.eyebrow}</p>
      <div className="progress"><span style={{ width: `${completed / tasks.length * 100}%` }} /></div>
      <div className="recording-meta">
        <span>第 {index + 1} / {tasks.length} 段</span>
        <span>建议 {duration.range}</span>
        <span>预计还需 {formatMinutes(estimatedRemaining)}</span>
      </div>
      <h2>{task.title}</h2>
      <div className="prompt-card"><p>{task.prompt}</p><small>{task.note}</small></div>
      {!supported && <p className="error">当前浏览器不支持录音。请通过 HTTPS 或 localhost 使用最新版 Chrome、Edge 或 Safari。</p>}
      {error && <p className="error">{error}</p>}
      <div className={`record-orb ${recording ? 'active' : ''}`} aria-hidden="true"><span>{recording ? elapsedLabel : processing ? '分析中' : '准备'}</span></div>
      <button className={`primary wide ${recording ? 'stop' : ''}`} disabled={!supported || processing} onClick={recording ? onStop : onStart}>{recording ? '结束并在本地分析' : processing ? '正在本地分析...' : '开始录音'}</button>
      <p className="microcopy">建议在安静环境中录制。音频不会离开这台设备。</p>
    </section>
  )
}

function AnalyzingScreen() {
  return (
    <section className="page centered analyzing">
      <div className="analysis-rings" aria-hidden="true"><i /><i /><i /></div>
      <p className="eyebrow">本地分析中</p>
      <h2>正在整理这次记录</h2>
      <p className="muted">提取语音节奏、能量、基频与频谱摘要，并加密写入本地保险箱。</p>
    </section>
  )
}

function ResultScreen({ session, onHome, onHistory }: { session: ScreeningSession; onHome: () => void; onHistory: () => void }) {
  const { phqResult, voiceFeatures, voiceResearchResult } = session
  const quick = session.experienceMode === 'quick'
  const presentation = session.experienceMode === 'presentation'
  return (
    <section className="page">
      <p className="eyebrow">{presentation ? '答辩展示结果' : quick ? '快速体验结果' : '本次自测结果'}</p>
      <div className="result-hero">
        <span>PHQ-9 · {phqResult.total} / 27</span>
        <h2>{phqResult.label}</h2>
        <p>{phqResult.recommendation}</p>
      </div>
      {quick && <div className="quick-result-note"><strong>这是一次未保存的体验结果</strong><p>本次录音、问卷和结果不会写入本地保险箱，也不会出现在历史记录中。</p></div>}
      {presentation && <div className="quick-result-note"><strong>这是答辩展示模拟结果</strong><p>本页数据由应用内置生成，不来自真实用户，不包含录音，也不会保存到本地保险箱。</p></div>}
      {phqResult.urgentSupport && <SupportCard urgent />}
      <div className="section-heading"><h3>语音研究特征概览</h3><span>仅作展示</span></div>
      <div className="metric-grid">
        <Metric label="有效语音" value={`${Math.round(voiceFeatures.activeVoiceRatio * 100)}%`} />
        <Metric label="停顿比例" value={`${Math.round(voiceFeatures.pauseRatio * 100)}%`} />
        <Metric label="基频中位数" value={`${voiceFeatures.pitchMedianHz} Hz`} />
        <Metric label={voiceResearchResult.resultKind === 'research-probability' ? '研究概率' : '演示指数'} value={`${voiceResearchResult.demoIndex} / 100`} />
      </div>
      <div className="research-note"><strong>{voiceResearchResult.label}</strong><p>{voiceResearchResult.explanation}</p></div>
      {!phqResult.urgentSupport && <SupportCard />}
      {quick || presentation ? <button className="primary wide" onClick={onHome}>返回首页</button> : <button className="primary wide" onClick={onHistory}>查看本地记录</button>}
      {!quick && !presentation && <button className="text-button wide" onClick={onHome}>返回首页</button>}
    </section>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric"><small>{label}</small><strong>{value}</strong></div>
}

function HistoryScreen({ sessions, envelopes, vaultMetadata, onBack, onDelete }: {
  sessions: ScreeningSession[]
  envelopes: Record<string, StoredSessionEnvelope>
  vaultMetadata?: VaultMetadata
  onBack: () => void
  onDelete: (id: string) => void
}) {
  return (
    <section className="page">
      <button className="back" onClick={onBack}>返回</button>
      <p className="eyebrow">本地保险箱</p>
      <h2>你的筛查记录</h2>
      <p className="muted">以下内容只保存在当前浏览器中。研究包导出后仍为加密文件。</p>
      {!sessions.length && <div className="empty"><h3>还没有本地记录</h3><p>完成一次自测后，记录会出现在这里。</p></div>}
      <div className="history-list">
        {sessions.map((session) => (
          <article className="history-card" key={session.id}>
            <div><p className="eyebrow">{formatDate(session.createdAt)}</p><h3>{session.phqResult.label}</h3><small>PHQ-9 {session.phqResult.total}/27 · {session.recordings.length} 段加密录音 · {session.screeningMode === 'eatd-research' ? '研究采集' : '普通自测'}</small></div>
            <div className="history-actions">
              <button disabled={!vaultMetadata} onClick={() => envelopes[session.id] && vaultMetadata && downloadResearchExport(envelopes[session.id], vaultMetadata)}>导出加密包</button>
              <button className="danger" onClick={() => onDelete(session.id)}>删除</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function UsageGuide({ compact = false, installPrompt, onInstall }: { compact?: boolean; installPrompt: boolean; onInstall: () => void }) {
  return (
    <details className={`usage-guide ${compact ? 'compact' : ''}`} open={!compact}>
      <summary>
        <span>可安装到手机主屏幕</span>
        <small>录音仅在本地处理</small>
      </summary>
      <div className="usage-head">
        <div>
          <p className="eyebrow">手机使用方式</p>
          <h3>直接打开，也可以安装到主屏幕</h3>
        </div>
        <a className="url-pill" href={APP_URL} target="_blank" rel="noreferrer">打开网址</a>
      </div>
      <p className="app-url">{APP_URL}</p>
      <ol>
        <li>Android：用 Chrome 或 Edge 打开上方网址，菜单中选择“安装应用”或“添加到主屏幕”。</li>
        <li>iPhone：用 Safari 打开上方网址，点击分享按钮，再选择“添加到主屏幕”。</li>
        <li>首次完整打开后，应用会缓存静态资源；离线时仍可重新打开已安装的应用。</li>
      </ol>
      <p className="usage-note">录音权限需要 HTTPS 环境。应用不会自动上传录音、问卷或分析结果。</p>
      {installPrompt && <button className="small-button" onClick={onInstall}>添加到主屏幕</button>}
    </details>
  )
}

function SettingsScreen({ portableModel, localStats, onBack, onWipe, onExportAll, onImportModel, onRemoveModel, onBeginResearch, installPrompt, onInstall }: {
  portableModel?: PortableVoiceModel
  localStats: LocalDataStats
  onBack: () => void
  onWipe: () => void
  onExportAll: () => void
  onImportModel: (file: File) => Promise<void>
  onRemoveModel: () => void
  onBeginResearch: () => void
  installPrompt: boolean
  onInstall: () => void
}) {
  const [modelMessage, setModelMessage] = useState('')
  const importModel = async (file?: File) => {
    if (!file) return
    try {
      await onImportModel(file)
      setModelMessage('研究模型已导入当前浏览器。')
    } catch (caught) {
      setModelMessage(caught instanceof Error ? caught.message : '无法导入研究模型')
    }
  }
  const modelStatus = modelStatusText(portableModel)
  return (
    <section className="page">
      <button className="back" onClick={onBack}>返回</button>
      <p className="eyebrow">隐私与设置</p>
      <h2>数据由你掌控</h2>
      <div className="settings-list">
        <article><h3>端侧处理</h3><p>录音、问卷与语音特征只在当前设备处理，不自动上传，不需要账号。</p></article>
        <article><h3>本地加密</h3><p>应用使用 AES-GCM-256 加密数据，并通过 PBKDF2-SHA-256 从你的口令派生密钥。</p></article>
        <article>
          <h3>本地数据统计</h3>
          <div className="stats-grid">
            <Metric label="本地记录" value={`${localStats.sessionCount} 条`} />
            <Metric label="加密录音" value={`${localStats.recordingCount} 段`} />
            <Metric label="最近记录" value={localStats.latestAt ? formatDate(localStats.latestAt) : '暂无'} />
            <Metric label="估算占用" value={formatBytes(localStats.estimatedUsageBytes)} />
          </div>
          <p>统计只在本机解锁后生成；不会上传，也不会显示单条问卷或录音内容。</p>
          <button className="small-button" onClick={onExportAll} disabled={!localStats.sessionCount}>导出全部加密包</button>
        </article>
        <article><h3>{modelStatus.title}</h3><p>{modelStatus.body}</p></article>
        <article>
          <h3>研究模型</h3>
          <p>{portableModel ? `已导入 EATD-Corpus 研究模型。验证集 ROC-AUC ${portableModel.validation.rocAuc.toFixed(2)}，召回率 ${portableModel.validation.recall.toFixed(2)}。` : '尚未导入研究模型。普通自测仍会使用未验证演示指数。'}</p>
          <label className="file-button">导入 .vmodel<input type="file" accept=".vmodel,application/json" onChange={(event) => void importModel(event.target.files?.[0])} /></label>
          {portableModel && <button className="small-button" onClick={onRemoveModel}>移除研究模型</button>}
          {modelMessage && <p className="model-message">{modelMessage}</p>}
        </article>
        <article>
          <h3>研究采集模式</h3>
          <p>使用与 EATD-Corpus 对齐的积极、中性和困扰回答。模型概率只在该模式展示，不改变 PHQ-9 风险等级。</p>
          <button className="small-button" onClick={onBeginResearch}>开始研究采集</button>
        </article>
        <UsageGuide installPrompt={installPrompt} onInstall={onInstall} />
      </div>
      <SupportCard />
      <button className="danger-button wide" onClick={onWipe}>清空本地保险箱</button>
    </section>
  )
}

export default App
