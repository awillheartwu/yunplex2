import { readFileSync } from 'node:fs'
import { test, expect } from './fixtures'
import type { TaskRun } from '../../server/lib/job/types'

const run: TaskRun = {
  id: 'timeline-classification-fixture', type: 'sync', trigger: 'user', status: 'partial',
  startedAt: '2026-11-01T00:00:00Z', finishedAt: '2026-11-01T00:00:02Z', durationMs: 2000,
  summary: '独立分类夹具', source: '测试来源', sourceIds: [], target: 'Plex',
  totalSongs: 2, successSongs: 0, failedSongs: 0, skippedSongs: 0, removedSongs: 0,
  warnings: 3, issueCounts: { deferred: 0, manual: 1, preserved: 0, ignored: 1, restricted: 0 },
  dryRun: false, config: {}, steps: [], songs: [
    { id: 'manual', songName: 'Manual fixture', artist: '', album: '', phase: 'done', status: 'awaiting_manual_match' },
    { id: 'ignored', songName: 'Ignored fixture', artist: '', album: '', phase: 'done', status: 'ignored_failure' },
  ],
}

for (const width of [1440, 390]) {
  test(`timeline keeps attention, skipped and historical results separate at ${width}px`, async ({ page, context, baseURL }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    if (process.env.YUNPLEX_ACCEPTANCE_SESSION_FILE) {
      const { cookie } = JSON.parse(readFileSync(process.env.YUNPLEX_ACCEPTANCE_SESSION_FILE, 'utf8')) as { cookie: string }
      await context.addCookies(cookie.split(';').filter(value => value.includes('=')).map(value => {
        const at = value.indexOf('=')
        return { name: value.slice(0, at).trim(), value: value.slice(at + 1), url: baseURL! }
      }))
    } else {
      await page.goto('/login')
      await page.getByLabel('管理员密码', { exact: true }).fill('browser-test-password')
      await page.getByRole('button', { name: '登录', exact: true }).click()
      await expect(page).toHaveURL('/')
    }
    await page.route(`**/api/runs/${run.id}`, route => route.fulfill({ json: { code: 0, msg: 'ok', data: run } }))
    await page.goto(`/task-center/runs/${run.id}`)
    const timeline = page.getByRole('list', { name: '运行过程摘要' })
    const attention = timeline.getByRole('listitem').filter({ has: page.getByRole('heading', { name: '1 项需要关注', exact: true }) })
    const skipped = timeline.getByRole('listitem').filter({ has: page.getByRole('heading', { name: '1 项已跳过', exact: true }) })
    const historical = timeline.getByRole('listitem').filter({ has: page.getByRole('heading', { name: '1 项历史提示', exact: true }) })
    await attention.getByRole('button', { name: '展开查看 1 项', exact: true }).click()
    await expect(attention.getByText('Manual fixture', { exact: true })).toBeVisible()
    await expect(attention).not.toContainText('Ignored fixture')
    await skipped.getByRole('button', { name: '展开查看 1 项', exact: true }).click()
    await expect(skipped.getByText('Ignored fixture', { exact: true })).toBeVisible()
    await expect(historical).toBeVisible()
    await expect(historical.getByRole('button')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`classification-${width}.png`), fullPage: true })
  })
}
