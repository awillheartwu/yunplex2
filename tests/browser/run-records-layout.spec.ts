import { expect, test } from './fixtures'

const ok = (data: unknown) => ({ code: 0, msg: 'ok', data })
const source = { id: 'run-layout', name: '夜间收藏', type: 'playlist', neteasePlaylistId: 123, enabled: true, initializationStatus: 'skipped', trackCount: 12 }
const base = { type: 'sync', trigger: 'schedule', startedAt: '2026-09-24T05:15:00Z', finishedAt: '2026-09-24T05:15:02Z', durationMs: 2000, source: '网易云音乐', totalSongs: 12, successSongs: 0, failedSongs: 0, skippedSongs: 12, removedSongs: 0, warnings: 0, dryRun: false, awaitingSourceSync: false, sourceRequestStatus: null }
const runs = [
  { ...base, id: 'success', status: 'success', summary: '1 个源，已存在 12 首' },
  { ...base, id: 'cancelled', status: 'cancelled', summary: '用户取消', totalSongs: 0, skippedSongs: 0 },
  { ...base, id: 'failed', status: 'failed', type: 'manual_download', trigger: 'user', summary: '部分歌曲下载失败，请查看失败原因', successSongs: 4, skippedSongs: 2, failedSongs: 3, warnings: 2, removedSongs: 1 },
  { ...base, id: 'pending', status: 'running', sourceRequestStatus: 'pending', summary: '等待来源同步', source: '很长的收藏名称用于检查换行以及容器溢出'.repeat(3) },
]

for (const width of [1440, 390]) {
  test(`run records share a readable responsive layout at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    await page.addInitScript(() => localStorage.setItem('yunplex2-theme', 'dark'))
    await page.goto('/login')
    await page.getByLabel('管理员密码', { exact: true }).fill('browser-test-password')
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await expect(page).toHaveURL('/')
    await page.route('**/api/runs**', route => route.fulfill({ json: ok({ items: runs, total: runs.length, earliestDate: base.startedAt }) }))
    await page.route('**/api/playlist-sources**', route => route.fulfill({ json: ok(new URL(route.request().url()).pathname === '/api/playlist-sources' ? [source] : source) }))
    for (const path of ['/task-center?tab=runs', '/sync-sources/run-layout', '/sync-sources/run-layout?tab=runs']) {
      await page.goto(path)
      const cards = page.locator('.run-card')
      const success = page.getByRole('link', { name: /同步任务.*网易云音乐.*已存在 12/ })
      await expect(success).toBeVisible()
      await expect(success.getByText('已存在 12', { exact: true })).toHaveCount(1)
      await expect(success).not.toContainText('已存在 12 首')
      await expect(success).toHaveAttribute('href', '/task-center/runs/success')
      if (path.includes('tab=runs')) {
        const pending = page.getByRole('link', { name: /同步任务.*很长的收藏名称.*等待执行/ })
        await expect(pending.getByText(runs[3]!.source, { exact: true })).toBeVisible()
        const failed = page.getByRole('link', { name: /手动下载.*失败 3/ })
        await expect(failed.getByText('失败 3', { exact: true })).toHaveCount(1)
        await expect(failed).toHaveAttribute('href', '/task-center/runs/failed')
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      expect(await cards.evaluateAll(nodes => nodes.every(node => node.scrollWidth <= node.clientWidth))).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`${path.startsWith('/task') ? 'activity' : path.includes('?') ? 'source-runs' : 'source-overview'}-dark.png`), fullPage: true, animations: 'disabled' })
    }
    await page.getByRole('button', { name: '切换到浅色主题' }).click()
    await expect(page.locator('html')).not.toHaveClass(/dark/)
    await page.screenshot({ path: testInfo.outputPath('source-runs-light.png'), fullPage: true, animations: 'disabled' })
    await page.route('**/api/runs/success', route => route.fulfill({ json: ok(null) }))
    const success = page.getByRole('link', { name: /同步任务.*网易云音乐.*已存在 12/ })
    await success.focus()
    await expect(success).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL('/task-center/runs/success')
    await page.route('**/api/runs**', route => route.fulfill({ json: ok({ items: [], total: 0 }) }))
    await page.goto('/task-center?tab=runs')
    await expect(page.getByText('暂无运行记录', { exact: true })).toBeVisible()
  })
}
