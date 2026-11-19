import type { AppConfig } from '../../server/lib/config/types'
import { expect, test } from './fixtures'
import { login } from './helpers/config'

test('source deletion uses the real API and the maintenance action describes existing-file repair', async ({ page }) => {
  await login(page)
  const created = await page.evaluate(async () => {
    const auth = await (await fetch('/api/auth/state')).json()
    return (await fetch('/api/playlist-sources', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': auth.data.csrfToken },
      body: JSON.stringify({ neteasePlaylistId: 990001, name: '隔离删除验收', type: 'playlist', enabled: false }),
    })).json()
  })
  expect(created.code).toBe(0)
  const id = created.data.id as string
  try {
    await page.goto(`/sync-sources/${id}`)
    await expect(page.getByRole('button', { name: '补全标签和词图', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '删除来源', exact: true }).click()
    await page.getByRole('dialog', { name: '删除同步源', exact: true }).getByRole('button', { name: '删除来源', exact: true }).click()
    await expect(page).toHaveURL('/sync-sources')
    const result = await page.evaluate(async sourceId => (await (await fetch(`/api/playlist-sources/${sourceId}`)).json()), id)
    expect(result.code).not.toBe(0)
  } finally {
    await page.evaluate(async sourceId => {
      const auth = await (await fetch('/api/auth/state')).json()
      await fetch(`/api/playlist-sources/${sourceId}`, { method: 'DELETE', headers: { 'X-CSRF-Token': auth.data.csrfToken } })
    }, id)
  }
})

test('useApi writes attach the session CSRF token and apply successful data', async ({ page }) => {
  await login(page)
  await page.goto('/config?tab=sync')

  const interval = page.getByLabel('同步间隔（分钟）', { exact: true })
  await expect(interval).toBeVisible()
  const auth = await page.evaluate(async () => (await (await fetch('/api/auth/state')).json()).data)
  let written: { method: string; csrfToken: string | undefined; contentType: string | undefined; body: AppConfig } | undefined

  await page.route('**/api/config', async route => {
    if (route.request().method() !== 'PUT') return route.continue()
    const body = route.request().postDataJSON() as AppConfig
    written = {
      method: route.request().method(),
      csrfToken: route.request().headers()['x-csrf-token'],
      contentType: route.request().headers()['content-type'],
      body,
    }
    await route.fulfill({ json: { code: 0, msg: 'ok', data: body } })
  })

  await interval.fill('46')
  await page.getByRole('button', { name: '保存配置', exact: true }).click()

  await expect(page.getByText('配置已保存', { exact: true })).toBeVisible()
  expect(written).toBeDefined()
  expect(written).toMatchObject({ method: 'PUT', contentType: expect.stringContaining('application/json') })
  expect(written?.csrfToken).toBe(auth.csrfToken)
  expect(written?.body.sync.intervalMinutes).toBe(46)
  expect(written?.body.netease.cookie).toBe('')
})

test('a 401 write response redirects to login with the current route preserved', async ({ page }) => {
  await login(page)
  await page.goto('/config?tab=sync')
  const interval = page.getByLabel('同步间隔（分钟）', { exact: true })
  await expect(interval).toBeVisible()

  let authRefreshes = 0
  await page.route('**/api/auth/state', async route => {
    authRefreshes++
    await route.fulfill({ json: { code: 0, msg: 'ok', data: {
      authEnabled: true,
      devAuthDisabled: false,
      authenticated: false,
      adminConfigured: true,
      setupRequired: false,
      setupCompleted: true,
      setupVersion: 1,
      requiredSetupVersion: 1,
      csrfToken: null,
      resetAvailable: false,
    } } })
  })

  await page.route('**/api/config', async route => {
    if (route.request().method() !== 'PUT') return route.continue()
    await route.fulfill({ status: 401, json: { code: 401, msg: '请先登录', data: null } })
  })

  await interval.fill('46')
  await page.getByRole('button', { name: '保存配置', exact: true }).click()

  await expect(page).toHaveURL(url => url.pathname === '/login' && url.searchParams.get('redirect') === '/config?tab=sync')
  expect(authRefreshes).toBeGreaterThan(0)
  await expect(page.getByLabel('管理员密码', { exact: true })).toBeVisible()
})

test('a 428 write response redirects to first setup', async ({ page }) => {
  await login(page)
  await page.goto('/config?tab=sync')
  const interval = page.getByLabel('同步间隔（分钟）', { exact: true })
  await expect(interval).toBeVisible()

  let authRefreshes = 0
  await page.route('**/api/auth/state', async route => {
    authRefreshes++
    await route.fulfill({ json: { code: 0, msg: 'ok', data: {
      authEnabled: true,
      devAuthDisabled: false,
      authenticated: true,
      adminConfigured: true,
      setupRequired: true,
      setupCompleted: false,
      setupVersion: 0,
      requiredSetupVersion: 1,
      csrfToken: 'setup-refresh-token',
      resetAvailable: false,
    } } })
  })

  await page.route('**/api/config', async route => {
    if (route.request().method() !== 'PUT') return route.continue()
    await route.fulfill({ status: 428, json: { code: 428, msg: '请先完成初始化', data: null } })
  })

  await interval.fill('46')
  await page.getByRole('button', { name: '保存配置', exact: true }).click()

  await expect(page).toHaveURL('/setup')
  expect(authRefreshes).toBeGreaterThan(0)
})
