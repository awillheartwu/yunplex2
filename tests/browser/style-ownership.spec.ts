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
    const initialization = { id: 'style-review', sourceId: source.id, status: 'awaiting_review', ruleVersion: 1, rulesCompatible: true, matchingConfig: { config: { enabled: true } }, totalItems: 1, preservedItems: 0, strongItems: 0, highConfidenceItems: 1, possibleItems: 0, ambiguousItems: 0, unmatchedItems: 0, adoptItems: 0, downloadItems: 0, deferredItems: 1, conflictItems: 0, createdAt: '2026-09-08', updatedAt: '2026-09-08' }
    const item = { initializationId: initialization.id, neteaseSongId: 1, position: 0, occurrenceCount: 1, title: '很长的歌曲名称与副标题 · Live Session', artists: ['测试艺人'], album: '专辑', tier: 'high_confidence', candidate: { ratingKey: 'candidate', title: 'Plex 候选', artist: '艺人', album: '专辑', filePath: '/music/artist/album/a-long-file-name.flac' }, candidates: [], evidence: { rule: 'strict_local_metadata' }, expectedBindingUpdatedAt: null, decisionStatus: 'proposed', kind: 'actionable', decision: 'defer', allowedDecisions: ['adopt', 'download', 'defer'], canSearch: true, unavailableReason: null }
    await page.route('**/api/playlist-sources/style-owner', route => route.fulfill({ json: ok(source) }))
    await page.route('**/api/playlist-sources/style-owner/initialization', route => route.fulfill({ json: ok({ applicable: true, initialization, downloadConcurrency: 3, convergenceQueueDepth: 0 }) }))
    await page.route('**/api/playlist-sources/style-owner/initialization/items**', route => route.fulfill({ json: ok({ items: [item], total: 1, page: 1, pageSize: 50 }) }))
    await page.route('**/api/runs**', route => route.fulfill({ json: ok({ items: [], total: 0 }) }))
    let previewAttempts = 0
    await page.route('**/api/initialization-matching/preview', route => {
      previewAttempts++
      return route.fulfill({ json: previewAttempts === 1 ? { code: 1, msg: '比较服务暂不可用', data: null } : ok({
        before: { recommended: 2070, unmatched: 321 }, after: { recommended: 2241, unmatched: 321 },
        items: [{ songId: 1, title: '变化样本歌曲', change: 'changed', reasons: ['匹配参数变化'], conflicts: [] }],
      }) })
    })
    await page.goto('/sync-sources/style-owner?tab=initialization')
    const groupRequest = page.waitForRequest(request => request.url().includes('/initialization/items') && new URL(request.url()).searchParams.get('tier') === 'recommended')
    await page.getByRole('navigation', { name: '候选分组' }).getByRole('button', { name: /推荐候选/ }).click()
    expect(new URL((await groupRequest).url()).searchParams.get('page')).toBe('1')
    if (width >= 768) {
      await page.getByRole('combobox', { name: '证据等级' }).click()
      await expect(page.getByRole('listbox', { name: '证据等级' }).getByRole('option')).toHaveCount(3)
      await page.keyboard.press('Escape')
    }
    await page.getByRole('navigation', { name: '候选分组' }).getByRole('button', { name: /^全部/ }).click()
    await page.screenshot({ path: `/tmp/compact-adoption-${width}.png`, fullPage: true })
    const snapshot = page.locator('.matching-snapshot')
    expect(await snapshot.evaluate(el => parseFloat(getComputedStyle(el).paddingLeft))).toBeGreaterThanOrEqual(16)
    const settingsLink = snapshot.getByRole('link', { name: '初始化匹配设置' })
    expect((await settingsLink.boundingBox())!.width).toBeLessThan(220)
    await page.getByRole('button', { name: '放弃方案并重新分析', exact: true }).click()
    const comparison = page.getByRole('dialog', { name: '重新分析', exact: true })
    await expect(comparison).toBeVisible()
    await expect(comparison.getByRole('alert')).toContainText('比较服务暂不可用')
    await expect(comparison.getByRole('button', { name: '确认创建新草案' })).toBeDisabled()
    await comparison.getByRole('button', { name: '重试比较' }).click()
    await expect(comparison.getByRole('button', { name: '确认创建新草案' })).toBeEnabled()
    await expect(comparison.locator('.matching-reanalysis__comparison')).toContainText('2241')
    expect(await comparison.locator('.matching-reanalysis').evaluate(el => parseFloat(getComputedStyle(el).paddingLeft))).toBeGreaterThanOrEqual(16)
    await comparison.getByText('查看变化样本（前 20 首）', { exact: true }).click()
    await expect(comparison.getByText('变化样本歌曲', { exact: true })).toBeVisible()
    for (const dark of [false, true]) {
      await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark)
      await comparison.scrollIntoViewIfNeeded()
      await page.screenshot({ path: `/tmp/reanalysis-${width}-${dark ? 'dark' : 'light'}.png`, fullPage: true })
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    }
    await comparison.getByRole('button', { name: '保留当前草案' }).click()
    await expect(comparison).toBeHidden()
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

for (const width of [375, 1440]) {
  test(`all evidence badges remain single-line at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await login(page)
    const source = { id: 'style-owner', name: '样式独立加载', neteasePlaylistName: '样式独立加载', neteasePlaylistId: 123, type: 'playlist', enabled: true, subscribed: false, coverUrl: '', trackCount: 1, plexPlaylistName: '目标', plexPlaylistRatingKey: 'target', lastStatus: 'idle', lastSyncedAt: null, initializationStatus: 'awaiting_review', initializationTotalItems: 1 }
    const initialization = { id: 'style-review', sourceId: source.id, status: 'awaiting_review', ruleVersion: 1, rulesCompatible: true, matchingConfig: { config: { enabled: true } }, totalItems: 1, preservedItems: 0, strongItems: 0, highConfidenceItems: 1, possibleItems: 0, ambiguousItems: 0, unmatchedItems: 0, adoptItems: 0, downloadItems: 0, deferredItems: 1, conflictItems: 0, createdAt: '2026-09-08', updatedAt: '2026-09-08' }
    const item = { initializationId: initialization.id, neteaseSongId: 1, position: 0, occurrenceCount: 1, title: '很长的歌曲名称与副标题 · Live Session', artists: ['测试艺人'], album: '专辑', tier: 'high_confidence', candidate: { ratingKey: 'candidate', title: 'Plex 候选', artist: '艺人', album: '专辑', filePath: '/music/artist/album/a-long-file-name.flac' }, candidates: [], evidence: { rule: 'strict_local_metadata' }, expectedBindingUpdatedAt: null, decisionStatus: 'proposed', kind: 'actionable', decision: 'defer', allowedDecisions: ['adopt', 'download', 'defer'], canSearch: true, unavailableReason: null }

    const tiers = ['strong_id', 'high_confidence', 'possible', 'ambiguous', 'unmatched', 'metadata_missing', 'conflict', 'preserved']
    const items = tiers.map((tier, i) => ({ ...item, tier, neteaseSongId: i + 1, title: `证据样本 ${i + 1}`, evidence: { rule: 'strict_local_metadata' } }))
    await page.route('**/api/playlist-sources/style-owner', route => route.fulfill({ json: ok(source) }))
    await page.route('**/api/playlist-sources/style-owner/initialization', route => route.fulfill({ json: ok({ applicable: true, initialization, downloadConcurrency: 3, convergenceQueueDepth: 0 }) }))
    await page.route('**/api/playlist-sources/style-owner/initialization/items**', route => route.fulfill({ json: ok({ items, total: items.length, page: 1, pageSize: 50 }) }))
    await page.route('**/api/runs**', route => route.fulfill({ json: ok({ items: [], total: 0 }) }))
    await page.goto('/sync-sources/style-owner?tab=initialization')
    for (let i = 0; i < tiers.length; i++) {
      const row = page.locator('.source-adoption__table tbody tr').filter({ hasText: `证据样本 ${i + 1}` })
      const listBadge = row.locator('.source-adoption__tier')
      await expect(listBadge).toBeVisible()
      const listBox = (await listBadge.boundingBox())!
      await row.getByRole('button', { name: '查看证据', exact: true }).click()
      const drawer = page.getByRole('dialog')
      const badge = drawer.locator('.source-adoption__tier')
      const box = (await badge.boundingBox())!
      expect(box.height).toBe(listBox.height)
      expect(box.width).toBeCloseTo(listBox.width, 0)
      const measure = await badge.evaluate(el => {
        const range = document.createRange()
        range.selectNodeContents(el)
        const css = getComputedStyle(el)
        return { lines: range.getClientRects().length, height: el.getBoundingClientRect().height, font: css.fontSize }
      })
      expect(measure.lines).toBe(1)
      expect(measure.font).toBe('12px')
      expect(measure.height).toBe(26)
      expect(await drawer.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
      if (tiers[i] === 'ambiguous') {
        await page.evaluate(() => document.documentElement.classList.add('dark'))
        await drawer.screenshot({ path: `/tmp/evidence-badges-${width}.png` })
      }
      await page.keyboard.press('Escape')
    }
  })
}
