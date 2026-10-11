import { expect, test } from './fixtures'
import { MEBIBYTE } from '../../shared/system-memory'
test('runtime readiness is public and diagnostics require a session; HTTP login persists', async ({ page, context }) => {
  await page.goto('/login')
  const initial = await page.evaluate(async () => {
    const ready = await fetch('/api/system/ready')
    const runtime = await fetch('/api/system/runtime')
    return { ready: await ready.json(), denied: runtime.status }
  })
  expect(initial.ready).toEqual({ code: 0, msg: 'ok', data: { ready: true, status: 'ready' } })
  expect(initial.denied).toBe(401)
  await page.getByLabel('管理员密码', { exact: true }).fill('browser-test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL('/')
  const session = (await context.cookies()).find(cookie => cookie.name === 'yunplex2_session')
  expect(session).toMatchObject({ httpOnly: true, secure: false, sameSite: 'Strict' })
  await page.reload(); await expect(page).toHaveURL('/')
  const metrics = await page.evaluate(async () => (await fetch('/api/system/runtime')).json())
  expect(metrics.code).toBe(0)
  expect(metrics.data.memory.rss).toBeGreaterThan(0)
  expect(metrics.data.memory.arrayBuffers).toBeGreaterThanOrEqual(0)
  expect(metrics.data.memoryContext).toMatchObject({
    mode: process.env.PLAYWRIGHT_PRODUCTION === '1' ? 'production' : 'development',
    rssScope: 'process', detailsScope: 'thread', isMainThread: process.env.PLAYWRIGHT_PRODUCTION === '1',
  })
  if (process.env.PLAYWRIGHT_PRODUCTION === '1') expect(metrics.data.memoryContext.threadId).toBe(0)
  else expect(metrics.data.memoryContext.threadId).toBeGreaterThan(0)
  expect(metrics.data.readiness.ready).toBe(true)
  const stats = await page.evaluate(async () => (await fetch('/api/system/stats')).json())
  expect(stats.data.memoryContext).toEqual(metrics.data.memoryContext)
  for (const key of ['rss', 'heapUsed', 'heapTotal', 'external', 'arrayBuffers']) {
    expect(stats.data.memory[key]).toBeGreaterThanOrEqual(0)
    expect(stats.data.mem[key]).toBe(Math.round(stats.data.memory[key] / MEBIBYTE))
  }
})
