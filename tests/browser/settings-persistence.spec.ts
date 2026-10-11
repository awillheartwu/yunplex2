import { expect, test } from './fixtures'
import { login, readConfig, updateConfig } from './helpers/config'

test('[P-03 P-04] real backend settings save, reload and discard', async ({ page }) => {
  await login(page)
  const original = await readConfig(page)
  try {
    await page.goto('/config?tab=sync')
    await page.getByLabel('同步间隔（分钟）', { exact: true }).fill('45')
    await page.getByRole('tab', { name: '外观', exact: true }).click()
    await page.getByRole('tab', { name: '同步策略', exact: true }).click()
    await expect(page.getByLabel('同步间隔（分钟）', { exact: true })).toHaveValue('45')
    await page.getByRole('button', { name: '保存配置', exact: true }).click()
    await expect.poll(async () => (await readConfig(page)).sync.intervalMinutes).toBe(45)
    await page.reload()
    await expect(page.getByLabel('同步间隔（分钟）', { exact: true })).toHaveValue('45')
    await page.getByLabel('同步间隔（分钟）', { exact: true }).fill('60')
    await page.getByRole('button', { name: '放弃修改', exact: true }).click()
    await expect(page.getByLabel('同步间隔（分钟）', { exact: true })).toHaveValue('45')
    expect((await readConfig(page)).sync.intervalMinutes).toBe(45)
  } finally { expect((await updateConfig(page, original)).status).toBe(200) }
})

test('[N-01 N-02 N-04 N-05 N-06] real backend artist matching and directed-write isolation', async ({ page }) => {
  await login(page)
  const original = await readConfig(page)
  try {
    expect((await updateConfig(page, { other: { artistAliases: {} }, initializationMatching: { artistAliases: [] } })).status).toBe(200)
    await page.goto('/config?tab=artists')
    const region = page.getByRole('region', { name: '艺人名称规则' })
    await page.getByRole('button', { name: '添加艺人', exact: true }).click()
    const save = page.getByRole('button', { name: '保存配置', exact: true })
    await expect(save).toBeDisabled()
    const name = page.getByRole('textbox', { name: '第 1 组艺人名称', exact: true })
    await name.fill('Test Artist')
    await page.getByLabel('第 1 组艺人别名', { exact: true }).fill('Alias A\nEarth, Wind & Fire')
    await name.click()
    await save.click()
    await expect.poll(async () => (await readConfig(page)).initializationMatching?.artistAliases[0]?.aliases).toEqual(['Alias A', 'Earth, Wind & Fire'])
    expect((await readConfig(page)).other.artistAliases).toEqual({})
    await expect(save).toBeEnabled()
    await region.getByRole('tab', { name: '写入替换', exact: true }).click()
    await region.getByRole('button', { name: '添加替换', exact: true }).click()
    await expect(save).toBeDisabled()
    await region.getByLabel('第 1 条原名称', { exact: true }).fill('Alias A')
    await region.getByLabel('第 1 条写入名称', { exact: true }).fill('Test Artist')
    await save.click()
    await expect.poll(async () => (await readConfig(page)).other.artistAliases).toEqual({ 'Alias A': 'Test Artist' })
    await expect(save).toBeEnabled()
    await region.getByRole('tab', { name: '匹配别名', exact: true }).click()
    await name.fill('Changed Artist')
    await save.click()
    await expect.poll(async () => (await readConfig(page)).initializationMatching?.artistAliases[0]?.name).toBe('Changed Artist')
    await page.reload()
    expect((await readConfig(page)).other.artistAliases).toEqual({ 'Alias A': 'Test Artist' })
    await region.getByRole('button', { name: '删除第 1 组艺人规则' }).click()
    await save.click()
    await expect.poll(async () => (await readConfig(page)).initializationMatching?.artistAliases).toEqual([])
    expect((await readConfig(page)).other.artistAliases).toEqual({ 'Alias A': 'Test Artist' })
  } finally { expect((await updateConfig(page, original)).status).toBe(200) }
})

test('[P-05] failed write preserves draft and server data, retry persists', async ({ page }) => {
  await login(page)
  const original = await readConfig(page)
  try {
    await page.goto('/config?tab=sync')
    await page.getByLabel('同步间隔（分钟）', { exact: true }).fill('47')
    await page.route('**/api/config', route => route.request().method() === 'PUT' ? route.abort('failed') : route.continue())
    await page.getByRole('button', { name: '保存配置', exact: true }).click()
    await expect(page.getByText('配置保存失败', { exact: true })).toBeVisible()
    await expect(page.getByLabel('同步间隔（分钟）', { exact: true })).toHaveValue('47')
    expect((await readConfig(page)).sync.intervalMinutes).toBe(original.sync.intervalMinutes)
    await page.unroute('**/api/config')
    await page.getByRole('button', { name: '保存配置', exact: true }).click()
    await expect.poll(async () => (await readConfig(page)).sync.intervalMinutes).toBe(47)
  } finally { await page.unroute('**/api/config'); expect((await updateConfig(page, original)).status).toBe(200) }
})

for (const [field, invalid] of [['intervalMinutes', 0], ['downloadConcurrency', 0], ['maxFailureAttempts', 0]] as const) {
  test(`[CFG boundary] ${field} invalid write is atomic`, async ({ page }) => {
    await login(page)
    const before = await readConfig(page)
    const result = await updateConfig(page, { sync: { [field]: invalid } })
    expect(result.body.code).not.toBe(0)
    expect(await readConfig(page)).toEqual(before)
  })
}
