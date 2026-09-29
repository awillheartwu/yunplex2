import { expect, test } from './fixtures'
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
  expect(metrics.data.readiness.ready).toBe(true)
})
