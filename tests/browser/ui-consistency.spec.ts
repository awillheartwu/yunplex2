import { expect, test, type Page } from './fixtures'

const ok = (data: unknown) => ({ code: 0, msg: 'ok', data })
const source = {
  id: 'consistency-a', name: '自建且已绑定', neteasePlaylistName: '自建且已绑定', neteasePlaylistId: 123,
  type: 'playlist', enabled: true, subscribed: false, coverUrl: '', trackCount: 1,
  plexPlaylistName: 'Plex 目标', plexPlaylistRatingKey: 'plex-1', lastStatus: 'idle', lastSyncedAt: null,
  syncLimit: null, syncIntervalMinutes: null, autoCreatePlexPlaylist: false, initializeMediaOnFirstSync: null,
  forceFullCompare: null, skipRemoveExtraTracks: null, skipPlexPlaylist: null,
  createdAt: '2026-09-08', updatedAt: '2026-09-08',
}
const second = { ...source, id: 'consistency-b', name: '收藏但未绑定', neteasePlaylistId: 456, subscribed: true, plexPlaylistRatingKey: null }
async function prepare(page: Page) {
  await page.goto('/login')
  await page.getByLabel('管理员密码', { exact: true }).fill('browser-test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible()
  await page.route('**/api/playlist-sources**', route => {
    if (route.request().method() !== 'GET') return route.fulfill({ status: 503, json: { code: 503, msg: '测试写入未配置' } })
    const url = new URL(route.request().url())
    const one = [source, second].find(item => url.pathname === `/api/playlist-sources/${item.id}`)
    const list = [source, second].filter(item => (!url.searchParams.has('subscribed') || item.subscribed === (url.searchParams.get('subscribed') === '1')) && (!url.searchParams.has('hasPlexTarget') || !!item.plexPlaylistRatingKey === (url.searchParams.get('hasPlexTarget') === '1')))
    return route.fulfill({ json: ok(one || list) })
  })
  await page.route('**/api/runs**', route => route.fulfill({ json: ok({ items: [], total: 0 }) }))
}
const home = (page: Page) => page.locator('.app-sidebar a[href="/"]')
const leaveDialog = (page: Page) => page.getByRole('dialog', { name: '有未保存的修改', exact: true })
async function beforeUnloadBlocked(page: Page) {
  return page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  })
}

test('global settings protect route changes and refresh, retain cancelled edits, and explicitly discard', async ({ page }) => {
  await prepare(page)
  await page.goto('/config')
  const field = page.getByLabel('音乐库名称', { exact: true })
  const original = await field.inputValue()
  await field.fill('尚未保存')
  expect(await beforeUnloadBlocked(page)).toBe(true)
  await home(page).click()
  await expect(leaveDialog(page)).toBeVisible()
  await leaveDialog(page).getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(field).toHaveValue('尚未保存')
  await home(page).click()
  await leaveDialog(page).getByRole('button', { name: '放弃修改并离开', exact: true }).click()
  await expect(page).toHaveURL('/')
  expect(await beforeUnloadBlocked(page)).toBe(false)
  await page.locator('.app-sidebar a[href="/config"]').click()
  await expect(field).toHaveValue(original)
})

test('source draft survives tabs and blocks changing the source identity until discarded', async ({ page }) => {
  await prepare(page)
  await page.goto('/sync-sources/consistency-a?tab=settings')
  const field = page.getByLabel('任务名称', { exact: true })
  await field.fill('未保存的来源名字')
  await page.getByRole('tab', { name: '概览', exact: true }).click()
  await page.getByRole('tab', { name: '设置', exact: true }).click()
  await expect(field).toHaveValue('未保存的来源名字')
  await page.getByRole('button', { name: '搜索页面与音乐收藏', exact: true }).click()
  await page.getByLabel('搜索页面与收藏', { exact: true }).fill(second.name)
  await page.getByLabel('搜索页面与收藏', { exact: true }).press('Enter')
  await expect(leaveDialog(page)).toBeVisible()
  await leaveDialog(page).getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(field).toHaveValue('未保存的来源名字')
  await page.getByRole('button', { name: '放弃修改', exact: true }).click()
  await expect(field).toHaveValue(source.name)
  expect(await beforeUnloadBlocked(page)).toBe(false)
  await page.getByRole('button', { name: '搜索页面与音乐收藏', exact: true }).click()
  await page.getByLabel('搜索页面与收藏', { exact: true }).fill(second.name)
  await page.getByLabel('搜索页面与收藏', { exact: true }).press('Enter')
  await expect(page).toHaveURL('/sync-sources/consistency-b')
  await page.getByRole('tab', { name: '设置', exact: true }).click()
  await expect(field).toHaveValue(second.name)
})

for (const kind of ['global', 'source'] as const) {
  test(`${kind} save failure preserves edits and a later response cannot erase typing made during save`, async ({ page }) => {
    await prepare(page)
    const path = kind === 'global' ? '/config' : '/playlist-sources/consistency-a'
    const initial = kind === 'global' ? page.evaluate(async () => {
      const response = await fetch('/api/config')
      if (!response.ok) throw new Error('读取测试配置失败')
      return (await response.json()).data
    }) : Promise.resolve(source)
    let stored = await initial, writes = 0
    let release = () => {}
    const pending = new Promise<void>(resolve => { release = resolve })
    await page.route(`**/api${path}`, async route => {
      if (route.request().method() === 'GET') return route.fulfill({ json: ok(stored) })
      writes++
      if (writes === 1) return route.fulfill({ status: 503, json: { code: 503, msg: '测试保存失败' } })
      if (writes === 2) await pending
      stored = { ...stored, ...route.request().postDataJSON() }
      return route.fulfill({ json: ok(stored) })
    })
    await page.goto(kind === 'global' ? '/config' : '/sync-sources/consistency-a?tab=settings')
    const field = page.getByLabel(kind === 'global' ? '音乐库名称' : '任务名称', { exact: true })
    const save = page.getByRole('button', { name: kind === 'global' ? '保存配置' : '保存设置', exact: true })
    await field.fill('首次修改')
    await save.click()
    await expect(page.getByText('测试保存失败', { exact: true })).toBeVisible()
    await expect(field).toHaveValue('首次修改')
    await save.click()
    await expect.poll(() => writes).toBe(2)
    await field.fill('保存期间继续输入')
    release()
    await expect(save).toBeEnabled()
    await expect(field).toHaveValue('保存期间继续输入')
    await expect(page.getByText('有未保存的修改', { exact: true })).toBeVisible()
    await save.click()
    await expect(page.getByText('所有设置已同步', { exact: true })).toBeVisible()
    expect(await beforeUnloadBlocked(page)).toBe(false)
    await home(page).click()
    await expect(page).toHaveURL('/')
  })
}

test('navigation waits for an in-flight save and continues after successful persistence', async ({ page }) => {
  await prepare(page)
  let release = () => {}
  const pending = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/config', async route => {
    if (route.request().method() === 'GET') return route.continue()
    await pending
    return route.fulfill({ json: ok(route.request().postDataJSON()) })
  })
  await page.goto('/config')
  await page.getByLabel('音乐库名称', { exact: true }).fill('等待保存')
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  await home(page).click()
  const dialog = page.getByRole('dialog', { name: '正在保存设置', exact: true })
  await expect(dialog.getByRole('button', { name: '放弃修改并离开', exact: true })).toBeDisabled()
  release()
  await expect(page).toHaveURL('/')
  expect(await beforeUnloadBlocked(page)).toBe(false)
})

test('Plex target filters have independent query state and keep legacy subscription links meaningful', async ({ page }) => {
  await prepare(page)
  await page.goto('/sync-sources?subscribed=subscribed')
  await expect(page.getByText('网易云：收藏的歌单', { exact: true })).toBeVisible()
  await expect(page.locator('.library-collection')).toContainText(second.name)
  await expect(page.locator('.library-collection')).not.toContainText(source.name)
  await page.getByRole('button', { name: '移除筛选：网易云：收藏的歌单', exact: true }).click()
  await page.getByRole('button', { name: /^筛选/ }).first().click()
  await page.getByRole('button', { name: '已绑定 Plex 目标', exact: true }).click()
  await page.getByRole('button', { name: '应用', exact: true }).click()
  await expect(page).toHaveURL(/plexTarget=bound/)
  await expect(page.locator('.library-collection')).toContainText(source.name)
  await expect(page.locator('.library-collection')).not.toContainText(second.name)
  await page.reload()
  await expect(page.getByText('Plex：已绑定目标', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /^筛选/ }).first().click()
  await page.getByRole('button', { name: '未绑定 Plex 目标', exact: true }).click()
  await page.getByRole('button', { name: '应用', exact: true }).click()
  await expect(page).toHaveURL(/plexTarget=unbound/)
  await expect(page.locator('.library-collection')).toContainText(second.name)
  await page.getByRole('button', { name: '移除筛选：Plex：未绑定目标', exact: true }).click()
  await expect(page.locator('.library-collection')).toContainText(source.name)
  await expect(page.locator('.library-collection')).toContainText(second.name)
})

async function prepareDrawer(page: Page) {
  await prepare(page)
  const item = { initializationId: 'review', neteaseSongId: 1, position: 0, occurrenceCount: 1, title: '审核歌曲', artists: ['艺人'], album: '专辑', trackNumber: 1, durationMs: 180000, tier: 'high_confidence', candidate: null, candidates: [], evidence: { rule: 'strict_local_metadata' }, expectedBindingUpdatedAt: null, decisionStatus: 'proposed', kind: 'actionable', decision: 'defer', allowedDecisions: ['adopt', 'download', 'defer'], canSearch: true, unavailableReason: null }
  const initialization = { id: 'review', sourceId: source.id, status: 'awaiting_review', ruleVersion: 1, rulesCompatible: true, totalItems: 1, preservedItems: 0, strongItems: 0, highConfidenceItems: 1, possibleItems: 0, ambiguousItems: 0, unmatchedItems: 0, adoptItems: 0, downloadItems: 0, deferredItems: 1, conflictItems: 0, createdAt: '2026-09-08', updatedAt: '2026-09-08' }
  await page.route('**/api/playlist-sources/consistency-a/initialization/items**', route => route.fulfill({ json: ok({ items: [item], total: 1, page: 1, pageSize: 50 }) }))
  await page.route('**/api/playlist-sources/consistency-a/initialization', route => route.fulfill({ json: ok({ applicable: true, initialization, downloadConcurrency: 3, convergenceQueueDepth: 0 }) }))
  await page.goto('/sync-sources/consistency-a?tab=initialization')
}

test('evidence drawer traps keyboard focus, supports disclosure summaries, and restores scroll and focus', async ({ page }) => {
  await prepareDrawer(page)
  await page.setViewportSize({ width: 375, height: 812 })
  const trigger = page.getByRole('button', { name: '查看证据', exact: true })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: '审核歌曲 证据详情', exact: true })
  const close = dialog.getByRole('button', { name: '关闭详情', exact: true })
  const search = dialog.getByRole('button', { name: '搜索其他 Plex 媒体', exact: true })
  await expect(close).toBeFocused()
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden')
  await page.keyboard.press('Shift+Tab')
  await expect(search).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(close).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(dialog.locator('summary')).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(dialog.locator('details')).toHaveAttribute('open', '')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')
})

for (const width of [375, 1280]) {
  test(`nested date picker closes only itself and retains the parent filter lock at ${width}px`, async ({ page }) => {
    await prepare(page)
    await page.setViewportSize({ width, height: 720 })
    await page.goto('/task-center?tab=runs')
    const trigger = page.locator('.filter-advanced-button')
    await trigger.click()
    const filter = page.getByRole('dialog', { name: '筛选条件', exact: true }).filter({ visible: true })
    const dateTrigger = filter.getByRole('button', { name: '日期筛选', exact: true })
    await dateTrigger.click()
    const date = page.getByRole('dialog', { name: '日期范围', exact: true })
    await expect(date.getByRole('button', { name: '上一个月', exact: true })).toBeFocused()
    await date.getByRole('button', { name: '上一个月', exact: true }).press('Shift+Tab')
    expect(await date.evaluate(element => element.contains(document.activeElement))).toBe(true)
    // Even a programmatic focus attempt on the parent must stay in the top modal.
    await dateTrigger.evaluate(element => (element as HTMLElement).focus())
    expect(await date.evaluate(element => element.contains(document.activeElement))).toBe(true)
    await page.keyboard.press('Escape')
    await expect(date).toBeHidden()
    await expect(filter).toBeVisible()
    await expect(dateTrigger).toBeFocused()
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden')
    await page.keyboard.press('Escape')
    await expect(filter).toBeHidden()
    await expect(trigger).toBeFocused()
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')
  })
}

test('mobile navigation and unsaved confirmation release their shared scroll lock after leaving', async ({ page }) => {
  await prepare(page)
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/config')
  await page.getByLabel('音乐库名称', { exact: true }).fill('手机编辑')
  await page.getByRole('button', { name: '打开导航', exact: true }).click()
  await page.getByRole('dialog', { name: '移动端导航', exact: true }).getByRole('link', { name: '工作台', exact: true }).click()
  await expect(leaveDialog(page)).toBeVisible()
  await leaveDialog(page).getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(page.getByLabel('音乐库名称', { exact: true })).toHaveValue('手机编辑')
  // The drawer may already close on the click; use the always-visible dock for the second attempt.
  await page.getByRole('navigation', { name: '快捷导航', exact: true }).getByRole('link', { name: '工作台', exact: true }).click()
  await leaveDialog(page).getByRole('button', { name: '放弃修改并离开', exact: true }).click()
  await expect(page).toHaveURL('/')
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')
  await expect(page.locator('.app-content')).not.toHaveAttribute('inert')
})

test('logout requests permission to discard edits before invalidating the session', async ({ page }) => {
  await prepare(page)
  let calls = 0
  await page.route('**/api/auth/logout', route => { calls++; return route.continue() })
  await page.goto('/config')
  await page.getByLabel('音乐库名称', { exact: true }).fill('退出前的编辑')
  const logout = page.getByRole('button', { name: '退出登录', exact: true })
  await logout.click()
  await expect(leaveDialog(page)).toBeVisible()
  expect(calls).toBe(0)
  await leaveDialog(page).getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(logout).toBeEnabled()
  expect(calls).toBe(0)
  await logout.click()
  await leaveDialog(page).getByRole('button', { name: '放弃修改并离开', exact: true }).click()
  await expect(page).toHaveURL('/login')
  expect(calls).toBe(1)
})
