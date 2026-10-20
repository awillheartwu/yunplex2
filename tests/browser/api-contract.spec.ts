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
