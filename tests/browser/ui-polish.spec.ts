import { expect, test, type Page } from './fixtures'

const source = {
  id: 'polish-source', name: '界面细化歌单', neteasePlaylistName: '界面细化歌单', neteasePlaylistId: 123,
  type: 'playlist', enabled: true, subscribed: false, coverUrl: '', trackCount: 3,
  plexPlaylistName: '界面细化歌单', plexPlaylistRatingKey: 'playlist-1', lastSyncedAt: null, lastStatus: 'idle',
  syncLimit: null, syncIntervalMinutes: null, autoCreatePlexPlaylist: false, initializeMediaOnFirstSync: null,
  forceFullCompare: null, skipRemoveExtraTracks: null, skipPlexPlaylist: null,
  createdAt: '2026-09-08T00:00:00Z', updatedAt: '2026-09-08T00:00:00Z',
}
const ok = (data: unknown) => ({ code: 0, msg: 'ok', data })
async function prepare(page: Page) {
  await page.goto('/')
  await page.getByLabel('管理员密码', { exact: true }).fill('browser-test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible()
  await page.route('**/api/playlist-sources**', async route => {
    if (route.request().method() !== 'GET') { await route.continue(); return }
    await route.fulfill({ json: ok(new URL(route.request().url()).pathname.endsWith('/polish-source') ? source : [source]) })
  })
  await page.route('**/api/runs**', route => route.fulfill({ json: ok({ items: [], total: 0 }) }))
}

test('run history failure does not hide the source and can be retried independently', async ({ page }) => {
  await prepare(page)
  await page.route('**/api/runs**', route => route.fulfill({ status: 503, json: { code: 503, msg: '运行记录暂不可用' } }))
  await page.goto('/sync-sources/polish-source?tab=runs')
  await expect(page.getByRole('heading', { name: source.name, exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('运行记录暂不可用')
  await expect(page.getByText('同步源不存在', { exact: true })).toHaveCount(0)
  await page.unroute('**/api/runs**')
  await page.route('**/api/runs**', route => route.fulfill({ json: ok({ items: [], total: 0 }) }))
  await page.getByRole('button', { name: '重试运行记录', exact: true }).click()
  await expect(page.getByText('暂无运行记录', { exact: true })).toBeVisible()
})

test('request completion refresh preserves the mounted settings editor', async ({ page }) => {
  await prepare(page)
  let sourceReads = 0, requestReads = 0
  await page.route('**/api/playlist-sources/polish-source', route => { sourceReads++; return route.fulfill({ json: ok(source) }) })
  await page.route('**/api/playlist-sources/polish-source/sync', route => route.fulfill({ json: ok({ count: 1, results: [{ sourceId: source.id, status: 'accepted', kind: 'convergence', requestId: 'polish-request', message: '已接受' }] }) }))
  await page.route('**/api/source-requests/polish-request', route => route.fulfill({ json: ok({ id: 'polish-request', sourceId: source.id, kind: 'convergence', status: ++requestReads === 1 ? 'pending' : 'completed' }) }))
  await page.goto('/sync-sources/polish-source')
  await page.getByRole('button', { name: '同步', exact: true }).click()
  await expect.poll(() => sourceReads).toBeGreaterThanOrEqual(2)
  await page.getByRole('tab', { name: '设置', exact: true }).click()
  await page.getByLabel('任务名称', { exact: true }).fill('保留编辑中的名字')
  await expect.poll(() => requestReads, { timeout: 10_000 }).toBeGreaterThanOrEqual(2)
  await expect.poll(() => sourceReads).toBeGreaterThanOrEqual(3)
  await expect(page.getByLabel('任务名称', { exact: true })).toHaveValue('保留编辑中的名字')
})

test('delete confirmation keeps errors visible, blocks repeated submission and restores focus', async ({ page }) => {
  await prepare(page)
  let calls = 0
  let release: () => void = () => {}
  const pending = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/playlist-sources/polish-source', async route => {
    if (route.request().method() === 'GET') { await route.fulfill({ json: ok(source) }); return }
    calls++
    if (calls === 1) { await pending; await route.fulfill({ status: 503, json: { code: 503, msg: '请重试删除' } }) }
    else await route.fulfill({ json: ok({}) })
  })
  await page.goto('/sync-sources/polish-source')
  await page.locator('.source-maintenance summary').click()
  const trigger = page.getByRole('button', { name: '删除来源', exact: true })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: '删除同步源', exact: true })
  await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.getByRole('button', { name: '删除来源', exact: true })).toBeFocused()
  await dialog.getByRole('button', { name: '删除来源', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '处理中…', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  expect(calls).toBe(1)
  release()
  await expect(dialog.getByRole('alert')).toContainText('请重试删除')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
  await trigger.click()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await dialog.getByRole('button', { name: '删除来源', exact: true }).click()
  await expect(page).toHaveURL('/sync-sources')
  expect(calls).toBe(2)
})

test('short mobile confirmation scrolls content while keeping actions inside the viewport', async ({ page }) => {
  await prepare(page)
  await page.setViewportSize({ width: 375, height: 480 })
  await page.route('**/api/playlist-sources/polish-source/redownload-preview', route => route.fulfill({ json: ok({ total: 100, eligible: 40, protectedExternal: 60, protectedManual: 10, snapshotAvailable: true }) }))
  await page.goto('/sync-sources/polish-source')
  await page.locator('.source-maintenance summary').click()
  await page.getByRole('button', { name: '重新下载托管媒体', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '重新下载托管音频并同步', exact: true })
  await expect(dialog.getByRole('button', { name: '确认重新下载', exact: true })).toBeInViewport()
  const bounds = await dialog.boundingBox()
  expect(bounds!.y).toBeGreaterThanOrEqual(0)
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(480)
  await expect.poll(() => dialog.locator('.confirm-panel__content').evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')
})

test('adding by ID is available with a healthy empty playlist list and validates input', async ({ page }) => {
  await prepare(page)
  await page.route('**/api/netease/playlists**', route => route.fulfill({ json: ok([]) }))
  let submitted: unknown = null
  await page.route('**/api/playlist-sources', async route => {
    if (route.request().method() === 'GET') { await route.fulfill({ json: ok([source]) }); return }
    submitted = route.request().postDataJSON()
    await route.fulfill({ json: ok({}) })
  })
  await page.goto('/sync-sources')
  await page.getByRole('button', { name: '添加歌单', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '添加音乐收藏', exact: true })
  await dialog.getByRole('button', { name: '直接输入资源 ID', exact: true }).click()
  const field = dialog.getByLabel('手动输入歌单 ID', { exact: true })
  await expect(field).toBeFocused()
  await field.fill('123oops')
  await field.press('Enter')
  await expect(dialog.getByRole('alert')).toContainText('请输入有效的资源 ID')
  expect(submitted).toBeNull()
  await field.fill('123456')
  await field.press('Enter')
  await expect(dialog).toBeHidden()
  expect(submitted).toMatchObject({ neteasePlaylistId: 123456, type: 'playlist' })
})

test('blank numeric overrides save as inheritance and failed defaults remain explicitly unknown', async ({ page }) => {
  await prepare(page)
  let submitted: Record<string, unknown> | null = null
  await page.route('**/api/playlist-sources/polish-source', async route => {
    if (route.request().method() === 'GET') { await route.fulfill({ json: ok({ ...source, syncIntervalMinutes: 15, syncLimit: 20 }) }); return }
    submitted = route.request().postDataJSON()
    await route.fulfill({ json: ok({ ...source, ...submitted }) })
  })
  await page.route('**/api/config', route => route.fulfill({ status: 503, json: { code: 503, msg: '无法读取设置' } }))
  await page.goto('/sync-sources/polish-source?tab=settings')
  await expect(page.getByRole('alert')).toContainText('继承值暂时未知')
  await expect(page.getByText('设置效果：尚未读取全局设置', { exact: true })).toHaveCount(2)
  await page.getByLabel('同步数量上限', { exact: true }).fill('')
  await page.getByLabel('自动同步间隔（分钟）', { exact: true }).fill('')
  await page.getByRole('button', { name: '保存设置', exact: true }).click()
  await expect.poll(() => submitted).toMatchObject({ syncLimit: null, syncIntervalMinutes: null })
  await expect(page.getByRole('alert')).toContainText('继承值暂时未知')
  await page.unroute('**/api/config')
  await page.getByRole('button', { name: '重试全局设置', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
})
