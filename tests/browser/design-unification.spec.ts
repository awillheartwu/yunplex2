import { expect, test, type Page } from './fixtures'
const ok = (data: unknown) => ({ code: 0, msg: 'ok', data })
const source = { id: 'design-source', name: '设计规范验收收藏', neteasePlaylistName: '设计规范验收收藏', neteasePlaylistId: 123, type: 'playlist', enabled: true, subscribed: false, coverUrl: 'https://covers.example.test/cover.jpg?param=80y80', trackCount: 12, plexPlaylistName: '目标歌单', plexPlaylistRatingKey: '1', lastStatus: 'success', lastSyncedAt: '2026-09-11', copyrightRestrictedCount: 0, actionableFailureCount: 0, initializationStatus: 'skipped', createdAt: '2026-09-11', updatedAt: '2026-09-11', syncLimit: null, syncIntervalMinutes: null, initializeMediaOnFirstSync: null, forceFullCompare: null, skipRemoveExtraTracks: null, skipPlexPlaylist: null }
async function login(page: Page, theme: 'light' | 'dark' = 'light') {
  await page.addInitScript(value => localStorage.setItem('yunplex2-theme', value), theme)
  await page.route('https://covers.example.test/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="#254a48"/><circle cx="400" cy="400" r="230" fill="#d6b690"/></svg>' }))
  await page.goto('/login')
  await page.getByLabel('管理员密码', { exact: true }).fill('browser-test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL('/')
  await page.route('**/api/playlist-sources**', route => {
    const url = new URL(route.request().url())
    const item = url.searchParams.get('type') === 'album' ? { ...source, id: 'design-album', type: 'album' } : source
    return route.fulfill({ json: ok(url.pathname === '/api/playlist-sources' ? [item] : source) })
  })
  await page.route('**/api/runs**', route => route.fulfill({ json: ok({ items: [], total: 0 }) }))
}
test('library requests HD art in grid mode, thumbnails in list mode, and import uses full content width', async ({ page }) => {
  await login(page)
  await page.setViewportSize({ width: 1800, height: 1000 })
  await page.goto('/sync-sources')
  await page.getByRole('button', { name: '网格视图', exact: true }).click()
  await expect(page.locator('.collection-item__art img')).toHaveAttribute('src', /param=800y800/)
  await page.getByRole('button', { name: '列表视图', exact: true }).click()
  await expect(page.locator('.collection-item__art img')).toHaveAttribute('src', /param=80y80/)
  await page.getByRole('tab', { name: /已保存专辑/ }).click()
  await page.getByRole('button', { name: '网格视图', exact: true }).click()
  await expect(page.locator('.collection-item__art img')).toHaveAttribute('src', /param=800y800/)
  await page.getByRole('button', { name: '列表视图', exact: true }).click()
  await expect(page.locator('.collection-item__art img')).toHaveAttribute('src', /param=80y80/)
  const library = await page.locator('.sync-sources-page').boundingBox()
  await page.goto('/manual-download')
  const manual = await page.locator('.manual-page').boundingBox()
  expect(Math.abs(manual!.width - library!.width)).toBeLessThan(2)
  expect(Math.abs(manual!.x - library!.x)).toBeLessThan(2)
})

test('maintenance hints explain consequences on hover and keyboard focus without triggering operations', async ({ page }, testInfo) => {
  await login(page)
  let writes = 0
  await page.route('**/api/**', route => {
    if (route.request().method() !== 'GET') { writes++; return route.fulfill({ json: ok({}) }) }
    return route.fallback()
  })
  await page.goto('/sync-sources/design-source')
  await expect(page.locator('.source-maintenance')).toBeVisible()
  const rebuild = page.getByRole('button', { name: '重建托管关联', exact: true })
  if (!await rebuild.isVisible()) await page.locator('.source-maintenance summary').click()
  await rebuild.scrollIntoViewIfNeeded()
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
  await rebuild.hover()
  await expect(page.getByRole('tooltip')).toContainText('不会覆盖手动选择')
  const id = await page.getByRole('tooltip').getAttribute('id')
  await expect(rebuild).toHaveAttribute('aria-describedby', id!)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('tooltip')).toBeHidden()
  await rebuild.focus()
  await expect(page.getByRole('tooltip')).toContainText('精确路径')
  if (process.env.UI_SCREENSHOTS === '1') await page.screenshot({ path: testInfo.outputPath('maintenance-hint.png'), animations: 'disabled' })
  expect(writes).toBe(0)
})
