import { expect, test, type Page } from './fixtures'

async function login(page: Page) {
  await page.goto('/')
  await page.getByLabel('管理员密码', { exact: true }).fill('browser-test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible()
}

test('settings categories support keyboard navigation and retain unsaved edits', async ({ page }) => {
  await login(page)
  await page.goto('/config')
  await page.getByLabel('音乐库名称', { exact: true }).fill('未保存的测试音乐库')
  await expect(page.getByText('有未保存的修改', { exact: true })).toBeVisible()
  const connection = page.getByRole('tab', { name: '服务连接', exact: true })
  await connection.focus()
  await connection.press('ArrowDown')
  await expect(page.getByRole('tab', { name: '下载与文件' })).toBeFocused()
  await expect(page.getByLabel('下载目录', { exact: true })).toBeVisible()
  await page.getByRole('tab', { name: '同步策略', exact: true }).click()
  await expect(page.getByRole('button', { name: /同步调度/ })).toBeVisible()
  await page.getByRole('tab', { name: '外观', exact: true }).click()
  await expect(page.getByLabel('字体缩放', { exact: true })).toBeVisible()
  await page.getByRole('tab', { name: '安全与维护', exact: true }).click()
  await expect(page.getByRole('button', { name: /危险操作/ })).toBeVisible()
  await connection.click()
  await expect(page.getByLabel('音乐库名称', { exact: true })).toHaveValue('未保存的测试音乐库')
  await expect(page.getByText('有未保存的修改', { exact: true })).toBeVisible()
})

test('settings load failure prevents saving defaults and offers a working retry', async ({ page }) => {
  await login(page)
  await page.route('**/api/config', route => route.fulfill({ status: 503, json: { code: 503, msg: '测试：配置读取暂不可用', data: null } }))
  await page.goto('/config')
  await expect(page.getByRole('alert')).toContainText('无法读取配置')
  await expect(page.getByRole('button', { name: '保存配置' })).toBeDisabled()
  await expect(page.getByLabel('音乐库名称', { exact: true })).toHaveCount(0)
  await page.unroute('**/api/config')
  await page.getByRole('button', { name: '重新加载', exact: true }).click()
  await expect(page.getByLabel('音乐库名称', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '保存配置' })).toBeEnabled()
})

test('mobile navigation traps focus, closes on Escape and releases page interaction', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await login(page)
  const menu = page.getByRole('button', { name: '打开导航', exact: true })
  await menu.click()
  const dialog = page.getByRole('dialog', { name: '移动端导航' })
  await expect(dialog.getByRole('link', { name: '工作台', exact: true })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.getByRole('button', { name: '关闭导航', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('link', { name: '工作台', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(menu).toBeFocused()
  await menu.click()
  await dialog.getByRole('link', { name: '活动', exact: true }).click()
  await expect(page).toHaveURL('/task-center')
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('tab', { name: '运行记录', exact: true })).toBeEnabled()
  await expect(page.locator('.app-content')).not.toHaveAttribute('inert')
})

test('primary workspaces fit mobile and desktop in both themes', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await login(page)
  const routes = [['/', '工作台'], ['/sync-sources', '音乐库'], ['/manual-download', '添加音乐'], ['/task-center', '活动'], ['/config', '偏好设置'], ['/system', '系统状态'], ['/logs', '运行日志']] as const
  for (const theme of ['light', 'dark'] as const) {
    const switcher = page.getByRole('button', { name: theme === 'light' ? '切换到浅色主题' : '切换到深色主题', exact: true })
    if (await switcher.isVisible()) await switcher.click()
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 1000 })
      for (const [path, title] of routes) {
        await page.goto(path)
        await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
        if (path === '/config') await expect(page.getByLabel('音乐库名称', { exact: true })).toBeVisible()
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        if (process.env.UI_SCREENSHOTS === '1') await page.screenshot({ path: testInfo.outputPath(`${theme}-${width}-${path.replaceAll('/', '') || 'overview'}.png`), fullPage: true })
      }
    }
  }
  expect(pageErrors).toEqual([])
})

test('mobile input help stays inside the viewport and maintenance settings remain discoverable', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await login(page)
  await page.goto('/manual-download')
  await page.getByRole('button', { name: '输入帮助', exact: true }).click()
  await expect(page.getByRole('tooltip')).toBeVisible()
  const help = await page.getByRole('tooltip').boundingBox()
  expect(help).not.toBeNull()
  expect(help!.x).toBeGreaterThanOrEqual(0)
  expect(help!.x + help!.width).toBeLessThanOrEqual(375)
  await page.goto('/config')
  const categories = page.getByRole('combobox', { name: '设置分类', exact: true })
  await expect(categories).toBeInViewport()
  await categories.selectOption('advanced')
  await expect(page.getByRole('button', { name: /危险操作/ })).toBeVisible()
})

test('log failures are distinct from an empty log and can be retried', async ({ page }) => {
  await login(page)
  await page.route('**/api/logs?*', route => route.fulfill({ status: 503, json: { code: 503, msg: '测试：日志暂不可用', data: null } }))
  await page.goto('/logs')
  await expect(page.getByRole('alert')).toContainText('日志读取失败')
  await expect(page.getByText('暂无诊断日志', { exact: true })).toHaveCount(0)
  await page.unroute('**/api/logs?*')
  await page.getByRole('button', { name: '重新加载', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByText('暂无诊断日志', { exact: true })).toBeVisible()
})

test('login and first setup keep their forms readable without changing credentials', async ({ page }, testInfo) => {
  await page.goto('/login')
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 1000 })
    await expect(page.getByRole('heading', { name: '欢迎回来', exact: true })).toBeVisible()
    await expect(page.getByLabel('管理员密码', { exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    if (process.env.UI_SCREENSHOTS === '1') await page.screenshot({ path: testInfo.outputPath(`login-${width}.png`), fullPage: true })
  }
  await page.route('**/api/auth/state', route => route.fulfill({ json: { code: 0, msg: 'ok', data: {
    authEnabled: true, devAuthDisabled: false, authenticated: false, adminConfigured: false,
    setupRequired: true, setupCompleted: false, setupVersion: 0, requiredSetupVersion: 1,
    csrfToken: null, resetAvailable: false,
  } } }))
  await page.goto('/setup')
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 1000 })
    await expect(page.getByRole('heading', { name: '连接你的音乐世界', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '创建并继续', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    if (process.env.UI_SCREENSHOTS === '1') await page.screenshot({ path: testInfo.outputPath(`setup-${width}.png`), fullPage: true })
  }
})

test('settings deep links, category search and discard preserve saved configuration', async ({ page }) => {
  await login(page)
  await page.goto('/config?tab=display')
  await expect(page.getByLabel('字体缩放', { exact: true })).toBeVisible()
  await page.getByRole('tab', { name: '服务连接', exact: true }).click()
  const original = await page.getByLabel('音乐库名称', { exact: true }).inputValue()
  await page.getByLabel('音乐库名称', { exact: true }).fill('临时编辑')
  await page.getByRole('button', { name: '放弃修改', exact: true }).click()
  await expect(page.getByLabel('音乐库名称', { exact: true })).toHaveValue(original)
  await page.getByLabel('查找设置分类', { exact: true }).fill('歌词')
  await expect(page.getByRole('tab', { name: '下载与文件', exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: '安全与维护', exact: true })).toHaveCount(0)
  await page.getByLabel('查找设置分类', { exact: true }).press('Tab')
  await expect(page.getByRole('tab', { name: '下载与文件', exact: true })).toBeFocused()
})
