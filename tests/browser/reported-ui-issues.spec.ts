import { selectListOption } from './helpers/list-select'
import { expect, test, type Page } from './fixtures'

const ok = (data: unknown) => ({ code: 0, msg: 'ok', data })
const source = {
  id: 'visual-source', name: '雾舞 Loica 的十二周年精选集', neteasePlaylistName: '十二周年精选集', neteasePlaylistId: 1001,
  type: 'playlist', subscribed: false, enabled: true, coverUrl: 'https://covers.example.test/cover.jpg?param=80y80',
  plexPlaylistName: '十二周年精选集', plexPlaylistRatingKey: '41353', trackCount: 12,
  lastStatus: 'success', lastSyncedAt: '2026-09-11T02:17:00Z', nextSyncAt: '2026-09-11T02:47:00Z',
  initializationStatus: 'completed', initializationTotalItems: 12, copyrightRestrictedCount: 0, actionableFailureCount: 0,
  syncLimit: null, syncIntervalMinutes: null, autoCreatePlexPlaylist: true, initializeMediaOnFirstSync: null,
  forceFullCompare: null, skipRemoveExtraTracks: null, skipPlexPlaylist: null,
  createdAt: '2026-09-10T00:00:00Z', updatedAt: '2026-09-11T00:00:00Z',
}
const initialization = {
  id: 'visual-init', sourceId: source.id, status: 'awaiting_review', rulesCompatible: true,
  totalItems: 12, preservedItems: 8, strongItems: 1, highConfidenceItems: 1, possibleItems: 1, ambiguousItems: 1,
  unmatchedItems: 0, adoptItems: 2, downloadItems: 1, deferredItems: 1, conflictItems: 0,
}
const cover = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="#254a48"/><circle cx="400" cy="370" r="230" fill="#e2c29d"/><circle cx="400" cy="370" r="190" fill="#254a48"/><circle cx="400" cy="370" r="100" fill="#e2c29d"/><text x="70" y="700" fill="white" font-size="65">RADIO / 12 YEARS</text></svg>'
async function prepare(page: Page) {
  await page.addInitScript(() => { localStorage.setItem('yunplex2-theme', 'light') })
  await page.route('https://covers.example.test/**', route => route.fulfill({ contentType: 'image/svg+xml', body: cover }))
  await page.goto('/login')
  await page.getByLabel('管理员密码', { exact: true }).fill('browser-test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL('/')
  await page.route('**/api/playlist-sources**', route => {
    if (route.request().method() !== 'GET') return route.fulfill({ status: 503, json: { code: 503, msg: '未配置测试写入' } })
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/initialization/items')) return route.fulfill({ json: ok({ total: 0, items: [], page: 1, pageSize: 50 }) })
    if (path.endsWith('/initialization')) return route.fulfill({ json: ok({ applicable: true, initialization, downloadConcurrency: 3, convergenceQueueDepth: 0 }) })
    return route.fulfill({ json: ok(path === '/api/playlist-sources' ? [source] : source) })
  })
  await page.route('**/api/runs**', route => route.fulfill({ json: ok({ items: [], total: 0 }) }))
}
async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}

test('workbench requests a larger cover and shows a bounded receipt dialog with keyboard dismissal', async ({ page }, testInfo) => {
  await prepare(page)
  await page.route('**/api/sync/trigger', route => route.fulfill({ json: ok({ triggered: true, results: Array.from({ length: 16 }, (_, index) => ({
    sourceId: `collection-${index}`, sourceName: `${source.name} ${index + 1}`, status: index % 2 ? 'awaiting_review' : 'accepted',
    kind: 'convergence', requestId: `request-${index}`, message: index % 2 ? '首次媒体接管等待确认' : '已接受同步请求',
  })) }) }))
  await page.goto('/')
  await expect(page.locator('.home-collection__cover img')).toHaveAttribute('src', /param=800y800/)
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 640 : 1000 })
    const trigger = page.getByRole('button', { name: '立即同步', exact: true })
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: '同步请求结果', exact: true })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('link', { name: '查看活动', exact: true })).toBeInViewport()
    await expect(dialog.getByRole('link', { name: '查看同步进度' }).first()).toHaveAttribute('href', '/sync-sources/collection-0?request=request-0')
    await expect.poll(() => dialog.locator('ul').evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true)
    await page.keyboard.press('Shift+Tab')
    await expect(dialog.getByRole('link', { name: '查看活动', exact: true })).toBeFocused()
    if (process.env.UI_SCREENSHOTS === '1') await page.screenshot({ path: testInfo.outputPath(`receipt-${width}.png`) })
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')
    await fits(page)
  }
})

test('collection overview, adoption filters, media rows and settings preserve hierarchy across viewport sizes', async ({ page }, testInfo) => {
  await prepare(page)
  const filterQueries: URLSearchParams[] = []
  await page.route('**/api/playlist-sources/visual-source/initialization/items**', route => {
    filterQueries.push(new URL(route.request().url()).searchParams)
    return route.fulfill({ json: ok({ total: 0, items: [], page: 1, pageSize: 50 }) })
  })
  await page.route('**/api/match-management/overview**', route => route.fulfill({ json: ok({ total: 3, page: 1, pageSize: 25, items: ['path', 'manual', 'path'].map((method, index) => ({
    target: { neteaseSongId: index + 1, title: ['Radio In My Head', '渡口', 'Easy Come Easy Go'][index], artists: ['测试艺人'], coverUrl: source.coverUrl },
    state: 'matched', binding: { neteaseSongId: index + 1, bindingMethod: method, status: 'active', plexRatingKey: String(index), plexFilePath: '/music/艺术家/专辑/01 - 很长的媒体文件名称.flac' },
    localMedia: { ownership: method === 'path' ? 'managed' : 'external', filePath: '/mounted/music/艺术家/专辑/01 - 很长的媒体文件名称.flac' },
    affectedSources: [],
  })) }) }))
  for (const width of [1440, 900, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/sync-sources/visual-source')
    await expect(page.getByRole('region', { name: '收藏同步状态' })).toContainText('同步成功')
    await expect(page.locator('.source-detail__summary')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '完整比较', exact: true })).toBeHidden()
    await page.locator('.source-maintenance summary').click()
    const operations = page.locator('.source-detail__operations .btn')
    expect(new Set(await operations.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height))).size).toBe(1)
    expect(await operations.locator('svg').count()).toBe(5)
    await page.locator('.source-maintenance summary').click()
    await fits(page)
    if (process.env.UI_SCREENSHOTS === '1') await page.screenshot({ path: testInfo.outputPath(`overview-${width}.png`), fullPage: true })

    await page.getByRole('tab', { name: '首次媒体接管', exact: true }).click()
    await expect(page.locator('.source-adoption__metrics')).toContainText('计划下载')
    if (width < 768) await page.getByRole('button', { name: /^筛选/ }).click()
    const evidence = page.getByRole('combobox', { name: '证据等级', exact: true }).filter({ visible: true })
    const decision = page.getByRole('combobox', { name: '处理决定', exact: true }).filter({ visible: true })
    await expect(evidence).toBeVisible()
    if (width >= 768) {
      const a = await evidence.boundingBox(), b = await decision.boundingBox()
      expect(Math.abs(a!.y - b!.y)).toBeLessThan(2)
      expect(a!.x + a!.width).toBeLessThanOrEqual(b!.x)
    }
    await selectListOption(page, evidence, 'high_confidence')
    await expect.poll(() => filterQueries.at(-1)?.get('tier')).toBe('high_confidence')
    await selectListOption(page, decision, 'download')
    await expect.poll(() => filterQueries.at(-1)?.get('decision')).toBe('download')
    if (width < 768) {
      await page.getByRole('button', { name: '完成', exact: true }).click()
      await expect(page.getByRole('dialog', { name: '筛选条件', exact: true })).toBeHidden()
      await expect(page.getByRole('button', { name: /^筛选/ })).toBeFocused()
    }
    await fits(page)
    if (process.env.UI_SCREENSHOTS === '1') await page.screenshot({ path: testInfo.outputPath(`adoption-${width}.png`), fullPage: true })

    await page.getByRole('tab', { name: '歌曲与媒体', exact: true }).click()
    await expect(page.locator('.source-media__row')).toHaveCount(3)
    const positions = await page.locator('.source-media__binding').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().x))
    expect(Math.max(...positions) - Math.min(...positions)).toBeLessThan(1)
    const buttons = page.locator('.source-media__actions .btn')
    expect(new Set(await buttons.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height))).size).toBe(1)
    await fits(page)
    if (process.env.UI_SCREENSHOTS === '1') await page.screenshot({ path: testInfo.outputPath(`media-${width}.png`), fullPage: true })

    await page.getByRole('tab', { name: '设置', exact: true }).click()
    await expect(page.getByRole('heading', { name: '收藏与目标', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: '同步安排', exact: true })).toBeVisible()
    await page.getByLabel('任务名称', { exact: true }).fill('修改名称')
    await expect(page.getByRole('button', { name: '保存设置', exact: true })).toBeInViewport()
    await page.getByRole('button', { name: '放弃修改', exact: true }).click()
    await expect(page.getByLabel('任务名称', { exact: true })).toHaveValue(source.name)
    await fits(page)
    if (process.env.UI_SCREENSHOTS === '1') await page.screenshot({ path: testInfo.outputPath(`settings-${width}.png`), fullPage: true })
  }
  await page.getByRole('button', { name: '切换到深色主题', exact: true }).click()
  await expect(page.getByLabel('任务名称', { exact: true })).toHaveCSS('background-color', 'rgb(32, 36, 32)')
  if (process.env.UI_SCREENSHOTS === '1') await page.screenshot({ path: testInfo.outputPath('settings-dark.png'), fullPage: true })
})

test('add collection dialog separates source type from entry mode and keeps list space', async ({ page }, testInfo) => {
  await prepare(page)
  await page.route('**/api/netease/playlists**', route => route.fulfill({ json: ok(Array.from({ length: 12 }, (_, index) => ({ id: index + 2000, name: `收藏歌单 ${index + 1}`, trackCount: 24, coverImgUrl: source.coverUrl, subscribed: false, creator: { nickname: '音乐收藏者' } }))) }))
  await page.route('**/api/netease/albums**', route => route.fulfill({ json: ok([{ id: 4000, name: 'Radio In My Head', size: 12, artist: { name: '朴树' }, picUrl: source.coverUrl }]) }))
  await page.goto('/sync-sources')
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.getByRole('button', { name: '添加歌单', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '添加音乐收藏', exact: true })
    await expect(dialog.getByText('收藏歌单 1', { exact: true })).toBeInViewport()
    await expect(dialog.getByRole('button', { name: '确认添加', exact: true })).toBeInViewport()
    await dialog.getByLabel('歌单范围', { exact: true }).selectOption('subscribed')
    await expect(dialog.getByText('没有符合条件的歌单，可调整筛选或直接输入资源 ID。', { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: '清除', exact: true }).click()
    await expect(dialog.getByText('收藏歌单 1', { exact: true })).toBeVisible()
    if (process.env.UI_SCREENSHOTS === '1') await page.screenshot({ path: testInfo.outputPath(`add-${width}.png`) })
    await dialog.getByRole('button', { name: '直接输入资源 ID', exact: true }).click()
    await expect(dialog.getByLabel('手动输入歌单 ID', { exact: true })).toBeFocused()
    await dialog.getByRole('button', { name: '专辑', exact: true }).click()
    await expect(dialog.getByLabel('手动输入专辑 ID', { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: '返回收藏列表', exact: true }).click()
    await expect(dialog.getByText('Radio In My Head', { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: '歌单', exact: true }).click()
    await expect(dialog.getByText('收藏歌单 1', { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await fits(page)
  }
})
