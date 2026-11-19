import { expect, test } from './fixtures'

test('client navigation shares one native stream and releases it at logout', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    const Native = window.EventSource
    const streams: EventSource[] = []
    Object.defineProperty(window, '__streamCounts', { get: () => ({ created: streams.length, active: streams.filter(s => s.readyState !== Native.CLOSED).length }) })
    window.EventSource = class extends Native {
      constructor(url: string | URL, options?: EventSourceInit) { super(url, options); streams.push(this) }
    }
  })
  await page.goto('/login')
  await page.getByLabel('管理员密码', { exact: true }).fill('browser-test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  const counts = () => page.evaluate(() => (window as unknown as { __streamCounts: { created: number; active: number } }).__streamCounts)
  await expect.poll(counts).toEqual({ created: 1, active: 1 })
  const nav = page.getByTestId('app-sidebar')
  for (let i = 0; i < 5; i++) {
    for (const name of ['音乐库', '活动', '系统状态', '工作台']) {
      await nav.getByRole('link', { name, exact: true }).click()
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
    }
  }
  await expect.poll(counts).toEqual({ created: 1, active: 1 })
  await page.getByRole('button', { name: '退出登录', exact: true }).click()
  await expect(page.getByLabel('管理员密码', { exact: true })).toBeVisible()
  await expect.poll(async () => (await counts()).active).toBe(0)
  expect(errors).toEqual([])
})

test('foreground and online resume refresh collection snapshots without recreating the stream', async ({ page }) => {
  let revision = 0
  let reads = 0
  await page.route('**/api/playlist-sources?**', route => {
    reads++
    return route.fulfill({ json: { code: 0, msg: 'ok', data: [{ id: 'recovery-source', name: `恢复后的收藏 ${revision}`, type: 'playlist', neteasePlaylistId: '1', trackCount: 1, enabled: false, lastStatus: 'idle' }] } })
  })
  await page.goto('/login')
  await page.getByLabel('管理员密码', { exact: true }).fill('browser-test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.getByTestId('app-sidebar').getByRole('link', { name: '音乐库', exact: true }).click()
  await expect(page.locator('.collection-item')).toContainText('恢复后的收藏 0')
  revision = 1
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(page.locator('.collection-item')).toContainText('恢复后的收藏 1')
  const before = reads
  revision = 2
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(page.locator('.collection-item')).toContainText('恢复后的收藏 2')
  expect(reads).toBeGreaterThan(before)
})

test('a real offline interval reconnects the stream and reloads missed collection changes', async ({ page, context }) => {
  let revision = 0
  await page.addInitScript(() => {
    const Native = window.EventSource
    const streams: EventSource[] = []
    Object.defineProperty(window, '__openStreams', { get: () => streams.filter(s => s.readyState === Native.OPEN).length })
    window.EventSource = class extends Native {
      constructor(url: string | URL, options?: EventSourceInit) { super(url, options); streams.push(this) }
    }
  })
  await page.route('**/api/playlist-sources?**', route => route.fulfill({ json: { code: 0, msg: 'ok', data: [{ id: 'offline-source', name: `断线恢复 ${revision}`, type: 'playlist', neteasePlaylistId: '1', trackCount: 1, enabled: false, lastStatus: 'idle' }] } }))
  await page.goto('/login')
  await page.getByLabel('管理员密码', { exact: true }).fill('browser-test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.getByTestId('app-sidebar').getByRole('link', { name: '音乐库', exact: true }).click()
  await expect(page.locator('.collection-item')).toContainText('断线恢复 0')
  const openStreams = () => page.evaluate(() => (window as unknown as { __openStreams: number }).__openStreams)
  await expect.poll(openStreams).toBe(1)
  await context.setOffline(true)
  await expect.poll(openStreams, { timeout: 6000 }).toBe(0)
  revision = 1
  await context.setOffline(false)
  await expect.poll(openStreams, { timeout: 10000 }).toBe(1)
  await expect(page.locator('.collection-item')).toContainText('断线恢复 1')
})
