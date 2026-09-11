import { expect, test } from './fixtures'

test('cached appearance and login render while service metadata hangs and all external requests are blocked', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('yunplex2-theme', 'light'); localStorage.setItem('yunplex2-font-scale', '1.25') })
  const external: string[] = []
  await page.route('**/*', route => {
    if (new URL(route.request().url()).hostname !== '127.0.0.1') { external.push(route.request().url()); return route.abort() }
    return route.continue()
  })
  await page.route('**/api/auth/state', async route => { await new Promise(resolve => setTimeout(resolve, 6000)); await route.abort().catch(() => {}) })
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await expect(page.getByLabel('管理员密码', { exact: true })).toBeVisible({ timeout: 1500 })
  await expect(page.locator('html')).toHaveCSS('font-size', '20px')
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await expect(page.getByText('暂时无法读取服务状态，可稍后重试登录。')).toBeVisible({ timeout: 6000 })
  expect(external).toEqual([])
})

test('local fonts load and stored appearance survives reload without fetching full config at startup', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('yunplex2-theme', 'dark'); localStorage.setItem('yunplex2-font-scale', '1.1') })
  let fullConfig = 0
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/config') fullConfig++ })
  await page.goto('/login')
  await expect(page.getByLabel('管理员密码', { exact: true })).toBeVisible()
  await page.evaluate(() => document.fonts.load('14px Inter'))
  expect(await page.evaluate(() => document.fonts.check('14px Inter'))).toBe(true)
  await expect(page.locator('html')).toHaveCSS('font-size', '17.6px')
  await page.reload()
  await expect(page.getByLabel('管理员密码', { exact: true })).toBeVisible()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(page.locator('html')).toHaveCSS('font-size', '17.6px')
  expect(fullConfig).toBe(0)
})

test('login synchronizes the protected appearance endpoint and settings save refreshes the non-sensitive cache', async ({ page }) => {
  await page.route('**/api/appearance', route => route.fulfill({ json: { code: 0, msg: 'ok', data: { fontScale: 1.2 } } }))
  await page.goto('/login')
  await page.getByLabel('管理员密码', { exact: true }).fill('browser-test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL('/')
  await expect(page.locator('html')).toHaveCSS('font-size', '19.2px')
  await page.route('**/api/config', async route => {
    if (route.request().method() === 'GET') return route.continue()
    return route.fulfill({ json: { code: 0, msg: 'ok', data: route.request().postDataJSON() } })
  })
  await page.goto('/config?tab=display')
  await page.getByLabel('字体缩放', { exact: true }).fill('1.3')
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  await expect(page.getByText('所有设置已同步', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('yunplex2-font-scale'))).toBe('1.3')
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => /cookie|token|password/i.test(key)))).toEqual([])
})

test('blocked browser storage still allows login and changing the collection view', async ({ page }) => {
  test.skip(process.env.PLAYWRIGHT_PRODUCTION !== '1', 'The development-only Vue devtools package accesses storage before app startup; verify this case against the production bundle.')
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => Object.defineProperty(window, 'localStorage', { get: () => { throw new DOMException('Storage unavailable', 'SecurityError') } }))
  await page.goto('/login')
  await expect(page.locator('html')).toHaveCSS('font-size', '16px')
  await page.getByLabel('管理员密码', { exact: true }).fill('browser-test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL('/')
  await page.getByTestId('app-sidebar').getByRole('link', { name: '音乐库', exact: true }).click()
  await page.getByRole('button', { name: '列表视图', exact: true }).click()
  await expect(page.getByRole('button', { name: '列表视图', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect(errors).toEqual([])
})
