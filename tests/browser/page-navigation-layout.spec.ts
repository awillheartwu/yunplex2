import { expect, test, type Page } from './fixtures'
const ok = (data: unknown) => ({ code: 0, msg: 'ok', data })
async function login(page: Page) {
  await page.addInitScript(() => localStorage.setItem('yunplex2-theme', 'light'))
  await page.goto('/login')
  await page.getByLabel('管理员密码', { exact: true }).fill('browser-test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL('/')
}
for (const width of [1440, 1024, 390]) {
  test(`page navigation keeps keyboard access and setting drafts at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    await login(page)
    await page.goto('/task-center')
    const nav = page.getByRole('tablist', { name: '活动视图', exact: true })
    await expect(nav).toBeVisible()
    await nav.getByRole('tab', { name: '进行中', exact: true }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(nav.getByRole('tab', { name: '运行记录', exact: true })).toBeFocused()
    await expect(page).toHaveURL(/tab=runs/)
    await expect(page.getByRole('searchbox', { name: '搜索运行记录' })).toBeVisible()
    await nav.getByRole('tab', { name: '进行中', exact: true }).click()
    await expect(page.locator('.activity-overview')).toBeVisible()
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: testInfo.outputPath('activity-light.png'), fullPage: true, animations: 'disabled' })

    await page.goto('/config?tab=general')
    const field = page.getByLabel('音乐库名称', { exact: true })
    await expect(field).toBeVisible()
    await field.fill('保留的未保存草稿')
    if (width < 768) {
      const select = page.getByRole('combobox', { name: '设置分类', exact: true })
      await expect(page.getByRole('tablist', { name: '设置分类' })).toHaveCount(0)
      await select.selectOption('display')
      await expect(page.getByLabel('字体缩放', { exact: true })).toBeVisible()
      await select.selectOption('general')
    } else {
      const tabs = page.getByRole('tablist', { name: '设置分类', exact: true })
      await tabs.getByRole('tab', { name: '服务连接' }).focus()
      await page.keyboard.press('ArrowRight')
      await expect(page.getByLabel('下载目录', { exact: true })).toBeVisible()
      await tabs.getByRole('tab', { name: '服务连接' }).click()
    }
    await expect(field).toHaveValue('保留的未保存草稿')
    await expect(page.getByText('有未保存的修改', { exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByRole('button', { name: '放弃修改', exact: true }).click()
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: testInfo.outputPath('settings-light.png'), fullPage: true, animations: 'disabled' })
    await page.getByRole('button', { name: '切换到深色主题' }).click()
    await page.screenshot({ path: testInfo.outputPath('settings-dark.png'), fullPage: true, animations: 'disabled' })
  })
}

test('activity record links switch the existing page to its requested view', async ({ page }) => {
  await login(page)
  const waiting = { id: 'waiting', type: 'source_initialization', status: 'awaiting_action', trigger: 'user', startedAt: new Date().toISOString(), durationMs: 1000, summary: '等待确认', source: '音乐收藏', sourceIds: ['one'], sourceNames: ['音乐收藏'], files: null, live: null }
  await page.route('**/api/task-center/activity', route => route.fulfill({ json: ok({ running: [], runningTotal: 0, waiting: [waiting], waitingTotal: 51, unlistedLive: null, updatedAt: new Date().toISOString() }) }))
  await page.goto('/task-center')
  await page.getByRole('link', { name: '已显示最近 1 项，查看全部 51 项' }).click()
  await expect(page).toHaveURL(/tab=runs&runStatus=awaiting_action/)
  await expect(page.locator('.run-records')).toBeVisible()
  await expect(page.getByRole('tab', { name: '运行记录', exact: true })).toHaveAttribute('aria-selected', 'true')
})
