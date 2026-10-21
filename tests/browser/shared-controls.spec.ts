import { expect, test } from './fixtures'

for (const width of [390, 1440]) {
  test(`diagnostic drawer keeps status visible and restores focus at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/login')
    await page.getByLabel('管理员密码', { exact: true }).fill('browser-test-password')
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible()
    await page.route('**/api/config/test-connection', route => route.fulfill({ json: { code: 0, msg: 'ok', data: { storageVisibility: {
      status: 'warning', summary: '尚未验证远端文件可见性', action: '请核对共享挂载',
      downloadDir: '/app/music', plexPathPrefix: '/music', sectionName: '音乐', sectionLocations: ['/music'],
      sample: { localPath: '/app/music/artist/album/song.flac', plexPath: '/music/artist/album/song.flac', roundTripLocalPath: '/app/music/artist/album/song.flac' },
      checks: [{ key: 'publication', label: '文件发布', status: 'warning', detail: '路径换算不传输文件' }],
    } } } }))
    await page.goto('/config?tab=media')
    await page.getByRole('button', { name: '检查下载目录', exact: true }).click()
    const trigger = page.getByRole('button', { name: '查看路径', exact: true })
    await expect(trigger).toBeVisible()
    await expect(page.getByText('路径设置需要调整', { exact: true })).toBeVisible()
    await trigger.click()
    const drawer = page.getByRole('dialog', { name: '音乐目录检查' })
    await expect(drawer.getByText('请核对共享挂载')).toBeVisible()
    await expect(page.locator('body')).toHaveCSS('overflow', 'hidden')
    await page.keyboard.press('Shift+Tab')
    await expect(drawer.getByRole('button', { name: '关闭音乐目录检查', exact: true })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(drawer).toBeHidden()
    await expect(trigger).toBeFocused()
    await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden')
    for (const dark of [false, true]) {
      await page.evaluate(value => document.documentElement.classList.toggle('dark', value), dark)
      await trigger.click()
      expect(await drawer.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
      if (process.env.UI_SCREENSHOTS === '1') await page.screenshot({ path: testInfo.outputPath(`diagnostic-${width}-${dark}.png`) })
      await page.keyboard.press('Escape')
    }
  })
}

test('run source filter keeps draft changes inside its dialog and handles nested Escape', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('管理员密码', { exact: true }).fill('browser-test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible()
  const queries: string[] = []
  await page.route('**/api/runs?**', route => { queries.push(new URL(route.request().url()).search); return route.fulfill({ json: { code: 0, msg: 'ok', data: { items: [], total: 0, earliestDate: null } } }) })
  await page.route('**/api/task-center/filter-options', route => route.fulfill({ json: { code: 0, msg: 'ok', data: { sources: [{ id: 'source-a', name: '测试来源', deleted: false }] } } }))
  await page.goto('/task-center?tab=runs')
  await page.getByRole('button', { name: '筛选', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '筛选条件', exact: true })
  const select = dialog.getByRole('combobox', { name: '来源', exact: true })
  await select.press('Enter')
  await expect(dialog.getByRole('listbox')).toBeVisible()
  await select.press('Escape')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('listbox')).toHaveCount(0)
  await select.press('End')
  await select.press('Enter')
  await expect(select).toContainText('测试来源')
  expect(queries.some(query => query.includes('sourceId=source-a'))).toBe(false)
  await dialog.getByRole('button', { name: '应用', exact: true }).click()
  await expect.poll(() => queries.some(query => query.includes('sourceId=source-a'))).toBe(true)
})

test('failure filters apply the themed source and stage choices only on confirmation', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('管理员密码', { exact: true }).fill('browser-test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible()
  const queries: URLSearchParams[] = []
  await page.route('**/api/tasks/failure-groups?**', route => { queries.push(new URL(route.request().url()).searchParams); return route.fulfill({ json: { code: 0, msg: 'ok', data: { items: [], total: 0, recordTotal: 0 } } }) })
  await page.route('**/api/task-center/filter-options', route => route.fulfill({ json: { code: 0, msg: 'ok', data: { sources: [{ id: 'source-a', name: '测试来源', deleted: false }] } } }))
  await page.goto('/task-center?tab=failures')
  await page.getByRole('button', { name: '筛选', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '筛选条件', exact: true })
  const stage = dialog.getByRole('combobox', { name: '异常原因', exact: true })
  await stage.click()
  await dialog.getByRole('option', { name: '下载失败', exact: true }).click()
  const source = dialog.getByRole('combobox', { name: '来源', exact: true })
  await source.press('End')
  await source.press('Enter')
  expect(queries.some(query => query.get('sourceId') === 'source-a')).toBe(false)
  await dialog.getByRole('button', { name: '应用', exact: true }).click()
  await expect.poll(() => queries.at(-1)?.get('sourceId')).toBe('source-a')
  expect(queries.at(-1)?.get('failureKind')).toBe('failed_download')
  expect(queries.at(-1)?.get('offset')).toBe('0')
})
