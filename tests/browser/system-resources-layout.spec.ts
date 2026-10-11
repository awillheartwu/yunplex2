import { expect, test } from './fixtures'
import { MEBIBYTE } from '../../shared/system-memory'
const ok = (data: unknown) => ({ code: 0, msg: 'ok', data })
for (const width of [1440, 390]) {
  test(`service and resources shows honest states with clear hierarchy at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    await page.addInitScript(() => localStorage.setItem('yunplex2-theme', 'light'))
    await page.goto('/login')
    await page.getByLabel('管理员密码', { exact: true }).fill('browser-test-password')
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await expect(page).toHaveURL('/')
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const stats = {
      cpu: 12, mem: { rss: 938, heapUsed: 40, heapTotal: 45, external: 3 },
      memory: { rss: 937.75 * MEBIBYTE, heapUsed: 40 * MEBIBYTE, heapTotal: 45 * MEBIBYTE, external: 3 * MEBIBYTE, arrayBuffers: 1536 },
      memoryContext: { mode: 'development', rssScope: 'process', detailsScope: 'thread', isMainThread: false, threadId: 2 },
      uptime: 3661, pid: 1234, dbSize: 4, plexOk: false, neteaseOk: true, dirWritable: false, dependencyCheckedAt: Date.now(), scheduler: null, timestamp: Date.now(),
    }
    await page.route('**/api/system/stats', async route => { await gate; await route.fulfill({ json: ok(stats) }) })
    let refreshes = 0
    await page.route('**/api/system/health/check', route => { refreshes++; return route.fulfill({ json: ok({ plexOk: true, neteaseOk: true, dirWritable: true, dependencyCheckedAt: Date.now() }) }) })
    await page.goto('/system')
    await expect(page.locator('.system-health__value').filter({ hasText: '待检测' })).toHaveCount(3)
    await expect(page.locator('.system-health')).not.toContainText('无法连接')
    await expect(page.locator('.system-kpi').filter({ hasText: '运行时间' })).toContainText('--')
    await expect(page.locator('.system-memory__reading')).toHaveCount(0)
    release()
    await expect(page.locator('.system-health')).toContainText('有项目需要处理')
    await expect(page.getByRole('heading', { name: '服务状态', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: '进程资源', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: '近期趋势', exact: true })).toBeVisible()
    await expect(page.locator('.system-kpi')).toHaveCount(4)
    await expect(page.locator('.system-kpi').first()).toContainText('12%')
    const memory = page.locator('.system-kpi').filter({ hasText: '进程内存' })
    const reading = memory.getByRole('button', { name: /^切换内存指标/ })
    await expect(reading).toHaveAttribute('aria-label', '切换内存指标，当前RSS 937.8 MiB')
    await expect(memory).toContainText('RSS · 全部线程')
    await expect(page.locator('.resource-legend')).toContainText('RSS 937.8 MiB')
    const resourceHeight = (await page.locator('.system-resources').boundingBox())!.height
    await page.locator('.system-resources').evaluate(element => element.scrollIntoView({ block: 'center' }))
    await reading.focus()
    await reading.hover()
    await expect(page.getByRole('tooltip')).toContainText('983,302,144 B')
    await expect(page.getByRole('tooltip')).toContainText('编译与热更新开销也计入 RSS')
    await page.keyboard.press('Escape')
    await reading.click()
    await expect(reading).toHaveAttribute('aria-label', '切换内存指标，当前堆 40.0 MiB')
    await expect(memory).toContainText('堆 · 当前线程')
    await page.getByRole('heading', { name: '进程资源', exact: true }).hover()
    await reading.hover()
    await expect(page.getByRole('tooltip')).toContainText('已分配 45.0 MiB')
    await expect(page.getByRole('tooltip')).toContainText('工作线程 #2')
    await page.keyboard.press('Escape')
    await reading.focus()
    await page.keyboard.press('Space')
    await expect(reading).toHaveAttribute('aria-label', '切换内存指标，当前外部 3.0 MiB')
    await page.keyboard.press('Enter')
    await expect(reading).toHaveAttribute('aria-label', '切换内存指标，当前缓冲 1.5 KiB')
    await page.getByRole('heading', { name: '进程资源', exact: true }).hover()
    await reading.hover()
    await expect(page.getByRole('tooltip')).toContainText('已包含在外部内存中')
    await page.keyboard.press('Escape')
    await reading.click()
    await expect(reading).toHaveAttribute('aria-label', '切换内存指标，当前RSS 937.8 MiB')
    expect((await page.locator('.system-resources').boundingBox())!.height).toBe(resourceHeight)
    await expect(page.getByRole('heading', { name: 'CPU 与内存', exact: true })).toHaveCSS('font-size', '16px')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    if (process.env.UI_SCREENSHOTS === '1') {
      await page.locator('.system-resources').evaluate(element => element.scrollIntoView({ block: 'center' }))
      await page.locator('.system-resources').screenshot({ path: testInfo.outputPath('services-light.png'), animations: 'disabled' })
    }
    await reading.click()
    await page.getByRole('button', { name: '重新检测', exact: true }).click()
    await expect(page.locator('.system-health')).toContainText('系统状态正常')
    await expect(reading).toHaveAttribute('aria-label', '切换内存指标，当前堆 40.0 MiB')
    expect(refreshes).toBe(1)
    await page.getByRole('button', { name: '关闭提示', exact: true }).click()
    await page.getByRole('button', { name: '切换到深色主题' }).click()
    await reading.click({ clickCount: 3 })
    await expect(reading).toHaveAttribute('aria-label', '切换内存指标，当前RSS 937.8 MiB')
    await page.evaluate(() => window.scrollTo(0, 0))
    if (process.env.UI_SCREENSHOTS === '1') {
      await page.locator('.system-resources').evaluate(element => element.scrollIntoView({ block: 'center' }))
      await page.locator('.system-resources').screenshot({ path: testInfo.outputPath('services-dark.png'), animations: 'disabled' })
    }
    await page.evaluate(() => document.documentElement.style.setProperty('--font-scale', '1.25'))
    await expect(memory.locator('strong')).toHaveCSS('font-size', '30px')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.evaluate(() => document.documentElement.style.setProperty('--font-scale', '1'))
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        writeText(value: string) { (window as Window & { copiedDiagnostic?: string }).copiedDiagnostic = value },
      } })
    })
    await page.getByRole('button', { name: '复制诊断信息', exact: true }).click()
    const report = await page.evaluate(() => JSON.parse((window as Window & { copiedDiagnostic?: string }).copiedDiagnostic || '{}'))
    expect(report.resources).toMatchObject({
      memoryUnit: 'MiB', memoryMb: { rss: 937.75 }, memoryBytes: stats.memory, memoryContext: stats.memoryContext,
    })
    await page.getByRole('link', { name: '查看日志', exact: true }).click()
    await expect(page.getByRole('tab', { name: '运行日志', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.system-logs-panel')).toBeVisible()
  })
}
