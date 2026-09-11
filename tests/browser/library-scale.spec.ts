import { expect, test, type Page } from './fixtures'

async function openLibrary(page: Page, count = 1000) {
  const sources = Array.from({ length: count }, (_, i) => ({ id: `large-${i}`, name: `收藏 ${String(i).padStart(4, '0')}`, neteasePlaylistName: `收藏 ${i}`, neteasePlaylistId: String(i + 1), type: 'playlist', enabled: false, subscribed: false, trackCount: 3000, lastStatus: 'idle', sortOrder: i }))
  await page.route('**/api/playlist-sources**', route => {
    if (route.request().method() !== 'GET') return route.continue()
    const search = new URL(route.request().url()).searchParams.get('search') || ''
    return route.fulfill({ json: { code: 0, msg: 'ok', data: sources.filter(s => s.name.includes(search)) } })
  })
  await page.goto('/login')
  await page.getByLabel('管理员密码', { exact: true }).fill('browser-test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.getByTestId('app-sidebar').getByRole('link', { name: '音乐库', exact: true }).click()
  await expect(page.locator('.collection-item')).toHaveCount(60)
}

test('large collections render a bounded page and keep cross-page selection', async ({ page }, testInfo) => {
  await openLibrary(page)
  expect(await page.locator('*').count()).toBeLessThan(4000)
  await page.getByLabel('选择 收藏 0000', { exact: true }).check()
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await expect(page.locator('.collection-item').first()).toContainText('收藏 0060')
  await page.getByLabel('选择 收藏 0060', { exact: true }).check()
  await expect(page.getByText('已选择 2 项', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '上一页', exact: true }).click()
  await expect(page.getByLabel('选择 收藏 0000', { exact: true })).toBeChecked()
  await page.getByLabel('选择全部收藏', { exact: true }).check()
  await expect(page.getByText('已选择 1000 项', { exact: true })).toBeVisible()
  await page.getByLabel('收藏页码', { exact: true }).selectOption('17')
  await expect(page.locator('.collection-item')).toHaveCount(40)
  await page.getByLabel('搜索同步源', { exact: true }).fill('收藏 0999')
  await expect(page.locator('.collection-item')).toHaveCount(1)
  await expect(page.locator('.collection-item')).toContainText('收藏 0999')
  await page.setViewportSize({ width: 375, height: 812 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await testInfo.attach('collection-metrics', { body: JSON.stringify({ fixtureCount: 1000, pageSize: 60, nodeBudget: 4000 }), contentType: 'application/json' })
})

test('dragging on the second page reorders the intended global source positions', async ({ page }) => {
  await openLibrary(page, 130)
  let orderedIds: string[] = []
  await page.route('**/api/playlist-sources/reorder', route => {
    orderedIds = route.request().postDataJSON().orderedIds
    return route.fulfill({ json: { code: 0, msg: 'ok', data: null } })
  })
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  const rows = page.locator('.collection-item')
  const transfer = await page.evaluateHandle(() => new DataTransfer())
  await rows.nth(0).dispatchEvent('dragstart', { dataTransfer: transfer })
  await rows.nth(2).dispatchEvent('dragover', { dataTransfer: transfer })
  await rows.nth(2).dispatchEvent('drop', { dataTransfer: transfer })
  await expect.poll(() => orderedIds.slice(59, 64)).toEqual(['large-59', 'large-61', 'large-62', 'large-60', 'large-63'])
  expect(orderedIds.slice(0, 3)).toEqual(['large-0', 'large-1', 'large-2'])
  expect(new Set(orderedIds).size).toBe(130)
})

test('three thousand parsed songs keep selection across bounded pages and submit the whole selection', async ({ page }) => {
  const songs = Array.from({ length: 3000 }, (_, i) => ({ id: i + 1, name: `曲目 ${i + 1}`, dt: 180000, artists: [{ name: '测试艺人' }], album: { id: 1, name: '测试专辑', picUrl: '' } }))
  await page.route('**/api/netease/playlist-songs?**', route => route.fulfill({ json: { code: 0, msg: 'ok', data: { songs, playlistName: '大歌单', trackIds: songs.map(s => ({ id: s.id })) } } }))
  await page.goto('/login')
  await page.getByLabel('管理员密码', { exact: true }).fill('browser-test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.getByTestId('app-sidebar').getByRole('link', { name: '添加音乐', exact: true }).click()
  await page.getByLabel('网易云链接、歌单 ID、专辑 ID 或歌曲 ID').fill('https://music.163.com/playlist?id=9988')
  await page.getByRole('button', { name: '解析并预览' }).click()
  await expect(page.locator('.manual-track-table tbody tr')).toHaveCount(100)
  await page.getByLabel('歌曲页码', { exact: true }).selectOption('2')
  await expect(page.getByLabel('选择 曲目 101', { exact: true })).toBeChecked()
  await page.getByLabel('选择 曲目 101', { exact: true }).uncheck()
  await page.getByLabel('歌曲页码', { exact: true }).selectOption('1')
  await expect(page.getByLabel('选择 曲目 1', { exact: true })).toBeChecked()
  await expect(page.getByText('已选择 2999 / 3000 首', { exact: true })).toBeVisible()
  let payload: Record<string, unknown> | null = null
  await page.route('**/api/download', route => {
    payload = route.request().postDataJSON()
    return route.fulfill({ json: { code: 0, msg: 'ok', data: { batchId: 'large-test-batch', total: 2999 } } })
  })
  await page.getByRole('button', { name: '下载 2999 首', exact: true }).click()
  await expect.poll(() => payload).not.toBeNull()
  expect(JSON.stringify(payload)).not.toContain('"songId":101,')
  expect((payload as unknown as { songIds: number[] }).songIds).toHaveLength(2999)
  expect((payload as unknown as { songIds: number[] }).songIds).not.toContain(101)
})
