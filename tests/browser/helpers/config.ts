import { type Page, expect } from '../fixtures'
import type { AppConfig } from '../../../server/lib/config/types'

export async function login(page: Page): Promise<void> {
  await page.goto('/')
  const passwordField = page.getByLabel('管理员密码')
  await expect(passwordField.or(page.getByRole('heading', { name: '工作台', exact: true }))).toBeVisible()
  if (await passwordField.isVisible()) {
    await passwordField.fill('browser-test-password')
    await page.getByRole('button', { name: '登录' }).click()
    await expect(page).toHaveURL('/')
  }
  await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible()
}

export async function readConfig(page: Page): Promise<AppConfig> {
  return page.evaluate(async () => (await (await fetch('/api/config')).json()).data)
}
export async function updateConfig(page: Page, config: unknown) {
  return page.evaluate(async value => {
    const auth = await (await fetch('/api/auth/state')).json()
    const response = await fetch('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': auth.data.csrfToken }, body: JSON.stringify(value) })
    return { status: response.status, body: await response.json() }
  }, config)
}
