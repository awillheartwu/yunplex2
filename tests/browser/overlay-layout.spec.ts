import { expect, test, type Locator, type Page } from '@playwright/test'
import { login } from './helpers/config'

// Playwright hides scrollbars by default, which masks the width change when a modal locks body.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] }, contextOptions: { reducedMotion: 'reduce' } })

const ok = (data: unknown) => ({ code: 0, msg: 'ok', data })
const sources = Array.from({ length: 30 }, (_, index) => ({
  id: `layout-${index}`, name: `收藏 ${index}`, neteasePlaylistName: `收藏 ${index}`,
  neteasePlaylistId: String(index + 1), type: 'playlist', enabled: false,
  subscribed: false, trackCount: 20, lastStatus: 'idle', sortOrder: index,
}))

async function startTrace(page: Page, trigger: Locator) {
  await trigger.scrollIntoViewIfNeeded()
  await trigger.focus()
  await page.evaluate(async () => {
    await document.fonts.ready
    const state = { frame: 0, samples: [] as unknown[] }
    const sample = () => ({
      scrollY,
      rects: ['.app-page-frame', '.app-topbar', '.app-sidebar', '.collection-item', '.mobile-dock', '.config-savebar']
        .map(selector => {
          const element = document.querySelector(selector)
          if (!element || !element.getClientRects().length) return null
          const { x, width, height } = element.getBoundingClientRect()
          return { selector, x, width, height }
        }),
    })
    const tick = () => { state.samples.push(sample()); state.frame = requestAnimationFrame(tick) }
    ;(window as unknown as { overlayTrace: typeof state }).overlayTrace = state
    tick()
  })
}

async function expectStableTrace(page: Page) {
  const samples = await page.evaluate(async () => {
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    const target = window as unknown as { overlayTrace?: { frame: number; samples: unknown[] } }
    const state = target.overlayTrace!
    cancelAnimationFrame(state.frame)
    delete target.overlayTrace
    return state.samples
  })
  expect(samples.length).toBeGreaterThan(1)
  for (const sample of samples) expect(sample).toEqual(samples[0])
}

async function checkOverlay(page: Page, trigger: Locator, dialog: Locator) {
  await startTrace(page, trigger)
  await trigger.click()
  await expect(dialog).toBeVisible()
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden')
  await page.mouse.wheel(0, 160)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
  await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden')
  await expectStableTrace(page)
}

for (const width of [1440, 390]) {
  test(`library filters, selectors and dialogs keep background geometry at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await login(page)
    await page.route('**/api/playlist-sources**', route => route.fulfill({ json: ok(sources) }))
    await page.route('**/api/netease/playlists**', route => route.fulfill({ json: ok([]) }))
    await page.goto('/sync-sources')
    await expect(page.locator('.collection-item')).toHaveCount(30)
    await page.addStyleTag({ content: '::-webkit-scrollbar { width: 16px; height: 16px; }' })
    // Assert that this is the scrollbar configuration which actually exposed the bug.
    expect(await page.evaluate(() => innerWidth - document.documentElement.clientWidth)).toBe(16)
    for (const dark of [false, true]) {
      await page.evaluate(value => {
        document.documentElement.classList.toggle('dark', value)
        document.documentElement.style.setProperty('--font-scale', value ? '1.25' : '1')
      }, dark)
      const filter = page.getByRole('button', { name: '筛选', exact: true })
      const dialog = page.getByRole('dialog', { name: '筛选条件', exact: true })
      await checkOverlay(page, filter, dialog)
      const sort = page.getByRole('combobox', { name: '收藏排序', exact: true })
      await startTrace(page, sort)
      await sort.click()
      await expect(page.getByRole('listbox')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('listbox')).toHaveCount(0)
      await expectStableTrace(page)
      await checkOverlay(page, page.getByRole('button', { name: '添加歌单', exact: true }), page.getByRole('dialog', { name: '添加音乐收藏', exact: true }))
      await checkOverlay(page, page.getByRole('button', { name: '搜索页面与音乐收藏', exact: true }), page.getByRole('dialog', { name: '搜索与快捷跳转', exact: true }))
      if (width < 768) await checkOverlay(page, page.getByRole('button', { name: '打开导航', exact: true }), page.getByRole('dialog', { name: '移动端导航', exact: true }))
      if (process.env.UI_SCREENSHOTS === '1') {
        await filter.click()
        await page.screenshot({ path: testInfo.outputPath(`filter-${width}-${dark ? 'dark' : 'light'}.png`) })
        await page.keyboard.press('Escape')
      }
    }
  })

  test(`nested date and source filters retain the parent lock at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await login(page)
    await page.route('**/api/runs?**', route => route.fulfill({ json: ok({ items: [], total: 0, earliestDate: null }) }))
    await page.route('**/api/tasks/failures?**', route => route.fulfill({ json: ok({ items: [], total: 0 }) }))
    await page.route('**/api/task-center/filter-options', route => route.fulfill({ json: ok({ sources: [{ id: 'layout-0', name: '收藏 0', deleted: false }] }) }))
    await page.goto('/task-center?tab=runs')
    await page.addStyleTag({ content: '.app-page-frame { min-height: 160dvh; } ::-webkit-scrollbar { width: 16px; }' })
    const trigger = page.getByRole('button', { name: '筛选', exact: true })
    const dialog = page.getByRole('dialog', { name: '筛选条件', exact: true })
    await startTrace(page, trigger)
    await trigger.click()
    const select = dialog.getByRole('combobox', { name: '来源', exact: true })
    await select.click()
    await expect(dialog.getByRole('listbox')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    const dateTrigger = dialog.getByRole('button', { name: '日期筛选', exact: true })
    await dateTrigger.click()
    const date = page.getByRole('dialog', { name: '日期范围', exact: true })
    await expect(date).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(date).toBeHidden()
    await expect(dateTrigger).toBeFocused()
    await expect(page.locator('body')).toHaveCSS('overflow', 'hidden')
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
    await expectStableTrace(page)
    await page.goto('/task-center?tab=failures')
    await checkOverlay(page, page.getByRole('button', { name: '筛选', exact: true }), dialog)
  })

  test(`diagnostic drawers and confirmations preserve scrolled settings at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await login(page)
    await page.route('**/api/config/test-connection', route => route.fulfill({ json: ok({ storageVisibility: {
      status: 'warning', summary: '尚未验证远端文件可见性', action: '请核对共享挂载',
      downloadDir: '/app/music', plexPathPrefix: '/music', sectionName: '音乐', sectionLocations: ['/music'],
      sample: { localPath: '/app/music/artist/album/song.flac', plexPath: '/music/artist/album/song.flac', roundTripLocalPath: '/app/music/artist/album/song.flac' }, checks: [],
    } }) }))
    await page.goto('/config?tab=media')
    await page.getByRole('button', { name: '测试下载路径', exact: true }).click()
    await checkOverlay(page, page.getByRole('button', { name: '查看诊断', exact: true }), page.getByRole('dialog', { name: '文件发布诊断', exact: true }))
    await page.goto('/config?tab=advanced')
    await checkOverlay(page, page.getByRole('button', { name: '恢复默认', exact: true }), page.getByRole('dialog', { name: '恢复默认配置', exact: true }))
  })
}
