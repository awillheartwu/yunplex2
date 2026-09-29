import { expect, test, type Page } from './fixtures'
import type { ActivityRun, ActivitySnapshot } from '../../shared/activity'
import type { SyncState } from '../../server/lib/log/types'

const ok = (data: unknown) => ({ code: 0, msg: 'ok', data })
const live: SyncState = { isRunning: true, currentRunId: 'sync', currentStage: 'downloading', startedAt: new Date().toISOString(), currentSourceName: '夜间收藏', currentSong: '长夜里的钢琴', lastSyncAt: null, lastSyncResult: null, syncCount: 0, successCount: 0, failureCount: 0, progress: { current: 4, total: 12 }, failures: [], dryRun: false }
const run = (overrides: Partial<ActivityRun> = {}): ActivityRun => ({ id: 'sync', type: 'sync', status: 'running', trigger: 'user', startedAt: new Date(Date.now() - 138000).toISOString(), finishedAt: null, durationMs: 11000, source: '网易云音乐', sourceIds: ['source-one'], sourceNames: ['夜间收藏'], totalSongs: 3475, successSongs: 0, failedSongs: 0, skippedSongs: 110, removedSongs: 0, warnings: 0, dryRun: false, summary: '分析完成：3475 首，22 首强身份，2075 首高置信', awaitingSourceSync: false, sourceRequestStatus: null, files: null, live: null, ...overrides })
const waiting = run({ id: 'plan', type: 'source_initialization', status: 'awaiting_action', sourceNames: ['雾舞Loica喜欢的音乐任务'] })
const sync = run({ live, files: { counts: { downloading: 2, tagging: 1, pending: 8, done: 12, failed: 1, total: 24 }, total: 11, items: ['downloading', 'downloading', 'tagging', 'pending'].map((status, i) => ({ id: `file-${i}`, sourceId: 'source-one', songId: i, songName: ['长夜里的钢琴', 'Luminous — 一首用于检查长名称显示的歌曲', '夏日来信', '等待天亮'][i]!, artist: '音乐人', album: '夜间收藏', status: status as 'downloading' | 'tagging' | 'pending', progress: [62, 28, 80, 0][i]!, retryCount: 0, createdAt: live.startedAt!, updatedAt: live.startedAt! })) } })
function snapshot(running: ActivityRun[] = [], awaiting: ActivityRun[] = []): ActivitySnapshot { return { running, waiting: awaiting, runningTotal: running.length, waitingTotal: awaiting.length, unlistedLive: null, updatedAt: new Date().toISOString() } }
async function login(page: Page) {
  await page.addInitScript(() => localStorage.setItem('yunplex2-theme', 'dark'))
  await page.goto('/login')
  await page.getByLabel('管理员密码', { exact: true }).fill('browser-test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL('/')
}
for (const width of [1440, 390]) {
  test(`activity separates execution, confirmation and empty/error states at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    await login(page)
    let data = snapshot([], [waiting])
    let fail = false
    await page.route('**/api/task-center/activity', route => route.fulfill({ json: fail ? { code: 1, msg: '测试：连接暂时中断', data: null } : ok(data) }))
    await page.goto('/task-center')
    const overview = page.locator('.activity-overview')
    const refresh = overview.getByRole('button', { name: '刷新', exact: true })
    await expect(overview.getByRole('heading', { name: '待你处理' })).toBeVisible()
    await expect(overview.getByRole('link', { name: '查看接管方案' })).toHaveAttribute('href', '/sync-sources/source-one?tab=initialization')
    await expect(overview).not.toContainText('下载中')
    await expect(overview).not.toContainText('191')
    await expect(overview.getByRole('progressbar')).toHaveCount(0)
    await expect(overview.getByRole('link', { name: '查看接管方案' })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('awaiting-dark.png'), fullPage: true, animations: 'disabled' })

    const manual = run({ id: 'manual', type: 'manual_download', sourceNames: ['并行的手动下载'], files: { counts: { pending: 1, downloading: 0, tagging: 0, done: 0, failed: 0, total: 1 }, items: [{ ...sync.files!.items[3]!, id: 'manual-file', songName: '并行下载的歌曲' }], total: 1 } })
    data = snapshot([sync, manual, run({ id: 'queued', sourceRequestStatus: 'pending', sourceNames: ['排队的来源'] })], [waiting])
    await refresh.click()
    await expect(overview.locator('.activity-run')).toHaveCount(4)
    const syncCard = overview.locator('.activity-run').filter({ has: page.getByRole('heading', { name: '夜间收藏', exact: true }) })
    await expect(syncCard.getByLabel('本次运行的文件任务统计')).toContainText('文件完成12')
    await expect(syncCard).toContainText('当前阶段已处理 4 / 12')
    await expect(overview).not.toContainText('整体进度')
    await expect(overview.getByText('等待执行', { exact: true })).toBeVisible()
    await expect(syncCard.getByRole('button', { name: '显示更多歌曲' })).toBeVisible()
    await page.route('**/api/downloads/tasks?**', route => {
      expect(new URL(route.request().url()).searchParams.get('runId')).toBe('sync')
      return route.fulfill({ json: ok({ items: [...sync.files!.items, { ...sync.files!.items[0], id: 'extra-file', songName: '队列中的更多歌曲' }], total: 5 }) })
    })
    await syncCard.getByRole('button', { name: '显示更多歌曲' }).click()
    await expect(syncCard.getByText('队列中的更多歌曲')).toBeVisible()
    await syncCard.getByRole('button', { name: '收起', exact: true }).click()
    await expect(syncCard.getByText('队列中的更多歌曲')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('executing-dark.png'), fullPage: true, animations: 'disabled' })

    data = snapshot([run({ live: { ...live, currentStage: 'refreshing_plex', progress: null, currentSong: null }, files: { counts: { pending: 0, downloading: 0, tagging: 0, done: 12, failed: 0, total: 12 }, items: [], total: 0 } })])
    await refresh.click()
    await expect(overview).toContainText('等待 Plex 识别')
    await expect(overview.locator('[aria-current="step"]')).toHaveText('Plex 更新')
    await expect(overview.getByRole('progressbar')).toHaveCount(0)
    await expect(overview.locator('.activity-song')).toHaveCount(0)
    await expect(overview).not.toContainText('当前没有正在追踪')

    fail = true
    await refresh.click()
    await expect(overview.getByRole('alert')).toContainText('保留上次读取的内容')
    await expect(overview.getByRole('button', { name: '取消本批同步' })).toBeDisabled()
    await expect(overview).not.toContainText('当前没有待办任务')
    fail = false
    data = snapshot([], [waiting])
    await overview.getByRole('button', { name: '重试', exact: true }).click()
    await expect(overview.getByRole('alert')).toHaveCount(0)
    await page.getByRole('button', { name: '切换到浅色主题' }).click()
    await expect(overview.locator('.activity-run')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    if (width < 720) expect((await page.locator('.activity-navigation').boundingBox())!.height).toBeLessThan(80)
    await page.screenshot({ path: testInfo.outputPath('awaiting-light.png'), fullPage: true, animations: 'disabled' })
    const action = overview.getByRole('link', { name: '查看接管方案' })
    await action.focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/sync-sources\/source-one\?tab=initialization/)

    data = snapshot()
    await page.goto('/task-center')
    await expect(overview.getByRole('heading', { name: '当前没有待办任务' })).toBeVisible()
    await expect(overview.locator('.activity-run')).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('idle-light.png'), fullPage: true, animations: 'disabled' })
  })
}

test('activity handles first-load failure, periodic completion, dry run and guarded cancellation', async ({ page }) => {
  await login(page)
  // Exercise the actual read-only endpoint against the disposable test database.
  const response = await page.evaluate(async () => (await fetch('/api/task-center/activity')).json())
  expect(response.code).toBe(0)
  expect(response.data.running).toEqual([])
  const staleCancel = await page.evaluate(async () => {
    const auth = await (await fetch('/api/auth/state')).json()
    return (await fetch('/api/sync/cancel', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': auth.data.csrfToken },
      body: JSON.stringify({ runId: 'no-longer-running' }),
    })).json()
  })
  expect(staleCancel.code).not.toBe(0)
  expect(staleCancel.msg).toContain('运行状态已变化')
  let data = snapshot([sync])
  let fail = true
  await page.route('**/api/task-center/activity', route => route.fulfill({ json: fail ? { code: 1, msg: '读取失败', data: null } : ok(data) }))
  await page.goto('/task-center')
  const overview = page.locator('.activity-overview')
  await expect(overview.getByRole('alert')).toBeVisible()
  await expect(overview).not.toContainText('当前没有待办任务')
  fail = false
  await overview.getByRole('button', { name: '重试', exact: true }).click()
  await expect(overview).toContainText('当前阶段已处理')
  data = snapshot()
  await expect(overview.getByRole('heading', { name: '当前没有待办任务' })).toBeVisible({ timeout: 10000 })
  data = { ...snapshot(), unlistedLive: { ...live, dryRun: true } }
  await overview.getByRole('button', { name: '刷新', exact: true }).click()
  await expect(overview.getByRole('heading', { name: '同步预演' })).toBeVisible()
  await expect(overview).not.toContainText('当前没有待办任务')
  await page.route('**/api/sync/cancel', async route => {
    expect(route.request().postDataJSON()).toEqual({ runId: 'sync' })
    data = snapshot()
    await route.fulfill({ json: ok(null) })
  })
  await overview.getByRole('button', { name: '取消本批同步' }).click()
  await expect(overview.getByRole('heading', { name: '当前没有待办任务' })).toBeVisible()
})
