import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173'
const artifactDir = fileURLToPath(new URL('./artifacts/', import.meta.url))
mkdirSync(artifactDir, { recursive: true })

function expect(value, message) {
  if (!value) throw new Error(message)
}

async function expectNoHorizontalOverflow(page, name) {
  const hasOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  )
  expect(!hasOverflow, `${name} has horizontal overflow`)
}

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
})

try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
  })
  const requestedUrls = []
  page.on('request', (request) => requestedUrls.push(request.url()))

  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: /听见心情/ }).waitFor()
  await expectNoHorizontalOverflow(page, 'welcome page')
  await page.screenshot({ path: join(artifactDir, 'welcome-mobile.png'), fullPage: true })

  const manifest = await page.evaluate(async () => {
    const href = document.querySelector('link[rel="manifest"]')?.href
    return href ? fetch(href).then((response) => response.json()) : undefined
  })
  expect(manifest?.name === '心声自测', 'manifest name is missing')
  expect(manifest?.lang === 'zh-CN', 'manifest language is not zh-CN')

  const serviceWorkerReady = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false
    await navigator.serviceWorker.ready
    return Boolean(await navigator.serviceWorker.getRegistration())
  })
  expect(serviceWorkerReady, 'service worker was not registered')

  await page.getByRole('button', { name: '开始一次自测' }).click()
  await page.getByRole('heading', { name: '由你掌控的本地自测' }).waitFor()
  await expectNoHorizontalOverflow(page, 'consent page')
  for (const checkbox of await page.locator('input[type="checkbox"]').all()) {
    await checkbox.check()
  }
  await page.getByRole('button', { name: '我已理解并继续' }).click()

  await page.getByRole('heading', { name: '先为数据加一把锁' }).waitFor()
  const passwordFields = page.locator('input[type="password"]')
  await passwordFields.nth(0).fill('local-test-passphrase')
  await passwordFields.nth(1).fill('local-test-passphrase')
  await page.getByRole('button', { name: '创建并继续' }).click()

  await page.getByText('PHQ-9 · 最近两周').waitFor()
  await expectNoHorizontalOverflow(page, 'questionnaire page')
  for (let index = 0; index < 9; index += 1) {
    await page.getByRole('button', { name: /完全没有/ }).click()
  }

  await page.getByRole('heading', { name: '读出十个中性词' }).waitFor()
  await page.waitForTimeout(450)
  await expectNoHorizontalOverflow(page, 'recording page')
  await page.screenshot({ path: join(artifactDir, 'recording-mobile.png'), fullPage: true })

  for (const nextHeading of [
    '朗读短文《北风与太阳》',
    '说说最近的日常节奏',
    '说说让你感到支持的事情',
  ]) {
    await page.getByRole('button', { name: '开始录音' }).click()
    await page.getByRole('button', { name: '结束并在本地分析' }).waitFor()
    await page.waitForTimeout(1200)
    await page.getByRole('button', { name: '结束并在本地分析' }).click()
    await page.getByRole('heading', { name: nextHeading }).waitFor()
  }
  await page.getByRole('button', { name: '开始录音' }).click()
  await page.getByRole('button', { name: '结束并在本地分析' }).waitFor()
  await page.waitForTimeout(1200)
  await page.getByRole('button', { name: '结束并在本地分析' }).click()
  await page.getByText('本次自测结果').waitFor()
  await page.getByText('PHQ-9 · 0 / 27').waitFor()
  await page.waitForTimeout(450)
  await expectNoHorizontalOverflow(page, 'result page')
  await page.screenshot({ path: join(artifactDir, 'result-mobile.png'), fullPage: true })

  await page.getByRole('button', { name: '查看本地记录' }).click()
  await page.getByRole('heading', { name: '你的筛查记录' }).waitFor()
  await page.getByText('4 段加密录音').waitFor()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出加密包' }).click()
  const download = await downloadPromise
  const exportPath = join(artifactDir, 'research-export.vscreen')
  await download.saveAs(exportPath)
  const exported = JSON.parse(readFileSync(exportPath, 'utf8'))
  expect(exported.format === 'voice-screening-research-package', 'research export format is invalid')
  expect(exported.schemaVersion === 2, 'research export schema is not independently decryptable')
  expect(Boolean(exported.vaultMetadata?.salt), 'research export is missing the PBKDF2 salt')
  expect(Boolean(exported.session?.payload?.ciphertext), 'research export is missing encrypted ciphertext')
  expect(!JSON.stringify(exported).includes('phqAnswers'), 'research export contains plaintext screening data')

  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '查看本地记录' }).click()
  await page.getByRole('heading', { name: '欢迎回来' }).waitFor()
  await page.locator('input[type="password"]').fill('local-test-passphrase')
  await page.getByRole('button', { name: '解锁并继续' }).click()
  await page.getByText('4 段加密录音').waitFor()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '删除' }).click()
  await page.getByRole('heading', { name: '还没有本地记录' }).waitFor()
  const sessionCount = await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('voice-screening-vault')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('sessions', 'readonly')
      const request = transaction.objectStore('sessions').count()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
      transaction.oncomplete = () => database.close()
    })
  })
  expect(sessionCount === 0, 'IndexedDB still contains sessions after deletion')

  await page.context().setOffline(true)
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: /听见心情/ }).waitFor()
  await page.getByText('离线可用').waitFor()
  await page.context().setOffline(false)

  const externalRequests = requestedUrls.filter((url) => !url.startsWith(baseUrl))
  expect(externalRequests.length === 0, `unexpected external requests: ${externalRequests.join(', ')}`)

  const androidPage = await browser.newPage({
    viewport: { width: 360, height: 800 },
    isMobile: true,
  })
  await androidPage.goto(baseUrl, { waitUntil: 'networkidle' })
  await androidPage.getByRole('heading', { name: /听见心情/ }).waitFor()
  await expectNoHorizontalOverflow(androidPage, 'Android welcome page')
  await androidPage.screenshot({ path: join(artifactDir, 'welcome-android.png'), fullPage: true })

  console.log(JSON.stringify({
    viewports: ['390x844', '360x800'],
    manifest: manifest.name,
    serviceWorkerReady,
    offlineReopen: true,
    externalRequests: externalRequests.length,
    exportedEncryptedPackage: true,
    finalScreen: 'empty-history-after-delete',
  }, null, 2))
} finally {
  await browser.close()
}
