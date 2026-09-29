import { expect, test, type Page } from './fixtures'
const ok = (data: unknown) => ({ code: 0, msg: 'ok', data })
const source = { id: 'design-source', name: '设计规范验收收藏', neteasePlaylistName: '设计规范验收收藏', neteasePlaylistId: 123, type: 'playlist', enabled: true, subscribed: false, coverUrl: 'https://covers.example.test/cover.jpg?param=80y80', trackCount: 12, plexPlaylistName: '目标歌单', plexPlaylistRatingKey: '1', lastStatus: 'success', lastSyncedAt: '2026-09-11', copyrightRestrictedCount: 0, actionableFailureCount: 0, initializationStatus: 'skipped', createdAt: '2026-09-11', updatedAt: '2026-09-11', syncLimit: null, syncIntervalMinutes: null, initializeMediaOnFirstSync: null, forceFullCompare: null, skipRemoveExtraTracks: null, skipPlexPlaylist: null }
async function login(page: Page, theme: 'light' | 'dark' = 'light') {
  await page.addInitScript(value => localStorage.setItem('yunplex2-theme', value), theme)
  await page.route('https://covers.example.test/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="#254a48"/><circle cx="400" cy="400" r="230" fill="#d6b690"/></svg>' }))
  await page.goto('/login')
  await expect(page.locator('h1')).toHaveCSS('font-weight', '600')
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
for (const theme of ['light', 'dark'] as const) for (const width of [1440, 390, 320]) {
  test(`all workspace routes share semantic headings and action controls at ${width}px ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    await login(page, theme)
    for (const path of ['/', '/sync-sources', '/manual-download', '/task-center', '/config', '/system', '/logs', '/match-reviews', '/sync-sources/design-source', '/sync-sources/design-source?tab=settings']) {
      await page.goto(path)
      await expect(page.locator('h1')).toBeVisible()
      const violations = await page.evaluate(() => {
        const errors: string[] = [], mobile = innerWidth < 768
        for (const node of document.querySelectorAll<HTMLElement>('h1,h2,h3,h4,[role="heading"]')) {
          if (!node.getClientRects().length) continue
          const level = node.getAttribute('aria-level') || node.tagName.slice(1), css = getComputedStyle(node)
          const expected = ({ '1': mobile ? 24 : 32, '2': 18, '3': 16, '4': 14 } as Record<string, number>)[level]
          if (expected && (parseFloat(css.fontSize) !== expected || css.fontWeight !== '600')) errors.push(`heading ${node.textContent?.trim().slice(0, 22)}: ${css.fontSize}/${css.fontWeight}`)
        }
        for (const node of document.querySelectorAll<HTMLElement>('p')) {
          if (!node.getClientRects().length) continue
          const css = getComputedStyle(node), size = parseFloat(css.fontSize)
          if (![12, 13, 14].includes(size)) errors.push(`body size ${node.textContent?.trim().slice(0, 22)}: ${size}`)
          if (Math.abs(parseFloat(css.lineHeight) / size - 1.6) > .01) errors.push(`body leading ${node.textContent?.trim().slice(0, 22)}: ${css.lineHeight}`)
        }
        for (const node of document.querySelectorAll<HTMLElement>('.btn,.icon-button,.filter-chip,select.form-input')) {
          if (!node.getClientRects().length) continue
          const css = getComputedStyle(node), size = node.getBoundingClientRect()
          if (size.height < (mobile ? 44 : 40) - .1) errors.push(`short control ${node.textContent?.trim().slice(0, 20)}: ${size.height}`)
          if (node.matches('.btn,.filter-chip,select') && css.fontSize !== '14px') errors.push(`control type ${node.textContent?.trim().slice(0, 20)}: ${css.fontSize}`)
          if (node.matches('.btn') && (parseFloat(css.borderTopWidth) < 1 || css.borderTopColor === 'rgba(0, 0, 0, 0)')) errors.push(`borderless action ${node.textContent?.trim().slice(0, 20)}`)
        }
        return errors
      })
      expect.soft(violations, path).toEqual([])
      expect.soft(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), path).toBe(true)
      if (process.env.UI_SCREENSHOTS === '1') await page.screenshot({ path: testInfo.outputPath(`${path.replaceAll(/[^a-z]/g, '-')}.png`), fullPage: true, animations: 'disabled' })
    }
  })
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
  await page.locator('.source-maintenance summary').click()
  const rebuild = page.getByRole('button', { name: '重建托管关联', exact: true })
  await rebuild.hover()
  await expect(page.getByRole('tooltip')).toContainText('保留人工决定')
  const id = await page.getByRole('tooltip').getAttribute('id')
  await expect(rebuild).toHaveAttribute('aria-describedby', id!)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('tooltip')).toBeHidden()
  await rebuild.focus()
  await expect(page.getByRole('tooltip')).toContainText('完整同步')
  if (process.env.UI_SCREENSHOTS === '1') await page.screenshot({ path: testInfo.outputPath('maintenance-hint.png'), animations: 'disabled' })
  expect(writes).toBe(0)
})
