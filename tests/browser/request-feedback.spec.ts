import { expect, test } from './fixtures'

test('request deep links restore pending progress after reload and show the terminal result', async ({ page }) => {
  const source = { id: 'feedback-source', name: '反馈验收收藏', neteasePlaylistId: '1', neteasePlaylistName: '反馈验收收藏', type: 'playlist', enabled: true, subscribed: false, trackCount: 1, lastStatus: 'idle', initializationStatus: 'skipped' }
  let status = 'pending'
  await page.route('**/api/playlist-sources/feedback-source', route => route.fulfill({ json: { code: 0, msg: 'ok', data: source } }))
  await page.route('**/api/runs?**', route => route.fulfill({ json: { code: 0, msg: 'ok', data: { items: [], total: 0 } } }))
  await page.route('**/api/source-requests/request-feedback', route => route.fulfill({ json: { code: 0, msg: 'ok', data: { id: 'request-feedback', sourceId: source.id, status, kind: 'convergence', runId: status === 'pending' ? null : 'run-feedback', error: status === 'failed' ? 'Plex 写入失败，请检查服务连接' : null } } }))
  await page.goto('/login')
  await page.getByLabel('管理员密码', { exact: true }).fill('browser-test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL('/')
  await page.goto('/sync-sources/feedback-source?request=request-feedback')
  const progress = page.getByRole('region', { name: '当前来源请求' })
  await expect(progress).toContainText('排队中')
  await page.reload()
  await expect(progress).toContainText('排队中')
  status = 'running'
  await expect(progress).toContainText('正在同步', { timeout: 6000 })
  status = 'failed'
  await expect(progress).toContainText('执行失败', { timeout: 6000 })
  await expect(progress).toContainText('Plex 写入失败，请检查服务连接')
  await expect(progress.getByRole('link', { name: '查看运行结果' })).toHaveAttribute('href', '/task-center/runs/run-feedback')
})

test('a temporary run read failure offers retry and does not masquerade as a missing record', async ({ page }) => {
  let fail = true
  await page.route('**/api/runs/read-recovery', route => fail
    ? route.fulfill({ status: 503, json: { code: 503, msg: '服务暂不可用', data: null } })
    : route.fulfill({ json: { code: 0, msg: 'ok', data: null } }))
  await page.goto('/login')
  await page.getByLabel('管理员密码', { exact: true }).fill('browser-test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL('/')
  await page.goto('/task-center/runs/read-recovery')
  await expect(page.getByRole('alert')).toContainText('暂时无法读取运行记录')
  await expect(page.getByText('运行记录不存在', { exact: true })).toHaveCount(0)
  fail = false
  await page.getByRole('button', { name: '重新加载', exact: true }).click()
  await expect(page.getByText('运行记录不存在', { exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})
