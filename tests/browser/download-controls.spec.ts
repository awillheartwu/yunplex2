import { expect, test } from './fixtures'
import { login } from './helpers/config'

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  for (const theme of ['light', 'dark']) {
    test(`download pause, resume and unknown progress ${viewport.width} ${theme}`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.addInitScript(value => localStorage.setItem('yunplex2-theme', value), theme)
      await login(page)
      let paused = false, blocked = true
      const actions: string[] = []
      const now = new Date().toISOString()
      const task = { id: 'audio-one', songId: 1, songName: '长音频', artist: '测试艺人', album: '专辑', sourceId: null, status: 'downloading', progress: -1, retryCount: 0, createdAt: now, updatedAt: now }
      await page.route('**/api/task-center/activity', route => route.fulfill({ json: { code: 0, msg: 'ok', data: {
        downloadControl: { paused: blocked, reason: blocked ? 'authentication' : null, message: blocked ? '网易云登录已失效，更新 Cookie 后继续下载。' : null, cooldownUntil: null },
        running: [{ id: 'large-batch', type: 'manual_download', trigger: 'user', startedAt: now, finishedAt: null, status: 'running', durationMs: 0,
          summary: '千首歌单下载', source: '千首歌单下载', sourceIds: [], sourceNames: [], totalSongs: 1500, successSongs: 0, failedSongs: 0, skippedSongs: 0, removedSongs: 0, warnings: 0, dryRun: false, live: null,
          files: { paused, counts: { total: 1500, pending: 1499, downloading: 1, tagging: 0, done: 0, failed: 0 }, total: 1500,
            items: [task, { ...task, id: 'audio-two', songId: 2, songName: '等待重试的歌曲', status: 'pending', progress: 0, nextAttemptAt: now, autoRetryCount: 1 }] },
        }], waiting: [], runningTotal: 1, waitingTotal: 0, unlistedLive: null, updatedAt: now,
      } } }))
      await page.route('**/api/runs/large-batch/downloads-control', async route => {
        const body = route.request().postDataJSON() as { action: string }
        paused = body.action === 'pause'; actions.push(body.action)
        await route.fulfill({ json: { code: 0, msg: 'ok', data: { count: 1500, paused } } })
      })
      await page.route('**/api/downloads/control', async route => {
        expect(route.request().postDataJSON()).toEqual({ action: 'resume' })
        blocked = false
        await route.fulfill({ json: { code: 0, msg: 'ok', data: {} } })
      })
      await page.goto('/task-center')
      await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*\bdark\b)/)
      await expect(page.getByText('网易云登录已失效，更新 Cookie 后继续下载。', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: '继续下载队列', exact: true }).click()
      await expect(page.getByRole('button', { name: '继续下载队列', exact: true })).toHaveCount(0)
      await expect(page.getByText('传输中', { exact: true })).toBeVisible()
      await expect(page.getByText('等待重试', { exact: true })).toBeVisible()
      await expect(page.locator('.activity-song progress')).not.toHaveAttribute('value')
      await page.getByRole('button', { name: '暂停下载', exact: true }).click()
      await expect(page.getByRole('button', { name: '继续下载', exact: true })).toBeVisible()
      await page.reload()
      await expect(page.getByRole('button', { name: '继续下载', exact: true })).toBeVisible()
      await page.screenshot({ path: `/tmp/reyunplex-download-controls-${theme}-${viewport.width}.png`, fullPage: true })
      await page.getByRole('button', { name: '继续下载', exact: true }).click()
      await expect(page.getByRole('button', { name: '暂停下载', exact: true })).toBeVisible()
      expect(actions).toEqual(['pause', 'resume'])
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    })
  }
}
