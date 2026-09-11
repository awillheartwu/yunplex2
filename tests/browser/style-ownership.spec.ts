import { expect, test, type Page } from './fixtures'

const ok = (data: unknown) => ({ code: 0, msg: 'ok', data })
async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('管理员密码', { exact: true }).fill('browser-test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible()
}

for (const width of [375, 1440]) {
  test(`cold source review and portal styles work at ${width}px without visiting the library`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await login(page)
    const source = { id: 'style-owner', name: '样式独立加载', neteasePlaylistName: '样式独立加载', neteasePlaylistId: 123, type: 'playlist', enabled: true, subscribed: false, coverUrl: '', trackCount: 1, plexPlaylistName: '目标', plexPlaylistRatingKey: 'target', lastStatus: 'idle', lastSyncedAt: null, initializationStatus: 'awaiting_review', initializationTotalItems: 1 }
    const initialization = { id: 'style-review', sourceId: source.id, status: 'awaiting_review', ruleVersion: 1, rulesCompatible: true, totalItems: 1, preservedItems: 0, strongItems: 0, highConfidenceItems: 1, possibleItems: 0, ambiguousItems: 0, unmatchedItems: 0, adoptItems: 0, downloadItems: 0, deferredItems: 1, conflictItems: 0, createdAt: '2026-09-08', updatedAt: '2026-09-08' }
    const item = { initializationId: initialization.id, neteaseSongId: 1, position: 0, occurrenceCount: 1, title: '很长的歌曲名称与副标题 · Live Session', artists: ['测试艺人'], album: '专辑', tier: 'high_confidence', candidate: { ratingKey: 'candidate', title: 'Plex 候选', artist: '艺人', album: '专辑', filePath: '/music/artist/album/a-long-file-name.flac' }, candidates: [], evidence: { rule: 'strict_local_metadata' }, expectedBindingUpdatedAt: null, decisionStatus: 'proposed', kind: 'actionable', decision: 'defer', allowedDecisions: ['adopt', 'download', 'defer'], canSearch: true, unavailableReason: null }
    await page.route('**/api/playlist-sources/style-owner', route => route.fulfill({ json: ok(source) }))
    await page.route('**/api/playlist-sources/style-owner/initialization', route => route.fulfill({ json: ok({ applicable: true, initialization, downloadConcurrency: 3, convergenceQueueDepth: 0 }) }))
    await page.route('**/api/playlist-sources/style-owner/initialization/items**', route => route.fulfill({ json: ok({ items: [item], total: 1, page: 1, pageSize: 50 }) }))
    await page.route('**/api/runs**', route => route.fulfill({ json: ok({ items: [], total: 0 }) }))
    await page.goto('/sync-sources/style-owner?tab=initialization')
    const table = page.locator('.source-adoption__table')
    await expect(table).toBeVisible()
    await expect(table).toHaveCSS('display', width < 640 ? 'block' : 'table')
    await expect(table.locator('.source-adoption__tier')).toHaveCSS('display', 'inline-flex')
    const footer = page.locator('.source-adoption__commit')
    await expect(footer).toHaveCSS('position', 'fixed')
    const footerBox = (await footer.boundingBox())!
    expect(footerBox.x).toBeGreaterThanOrEqual(0)
    expect(footerBox.x + footerBox.width).toBeLessThanOrEqual(width)
    if (width < 768) expect(footerBox.y + footerBox.height).toBeLessThanOrEqual((await page.locator('.mobile-dock').boundingBox())!.y)
    for (const dark of [false, true]) {
      await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark)
      await page.getByRole('button', { name: '查看证据', exact: true }).click()
      const drawer = page.getByRole('dialog', { name: `${item.title} 证据详情`, exact: true })
      await expect(drawer).toHaveCSS('position', 'fixed')
      await expect(drawer).toHaveCSS('overflow-y', 'auto')
      // The badge is a flex item here, so its computed outer display is blockified.
      await expect(drawer.locator('.source-adoption__tier')).toHaveCSS('display', 'flex')
      expect(await drawer.evaluate(element => element.closest('.source-adoption') === null)).toBe(true)
      const box = (await drawer.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1)
      await page.keyboard.press('Escape')
      await expect(drawer).toBeHidden()
    }
  })
}

test('rendered recommendation badges use the theme foreground in both color modes', async ({ page }) => {
  await login(page)
  await page.goto('/config?tab=sync')
  const badge = page.locator('.removal-policy__badge').first()
  await expect(badge).toBeVisible()
  for (const dark of [false, true]) {
    await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark)
    const colors = await badge.evaluate(element => {
      const probe = document.createElement('span')
      probe.style.color = 'var(--on-accent)'
      element.append(probe)
      const result = { actual: getComputedStyle(element).color, expected: getComputedStyle(probe).color }
      probe.remove()
      return result
    })
    expect(colors.actual).toBe(colors.expected)
  }
})
