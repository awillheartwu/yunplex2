import { expect, test, type Page } from './fixtures'
const ok = (data: unknown) => ({ code: 0, msg: 'ok', data })
const songs = [1, 2, 3].map(id => ({ id, name: ['长夜里的钢琴', '第二首歌曲', '很长的歌曲名称用于检查窄屏时的文字换行'][id - 1], no: id, dt: 180000, disc: '1', artists: [{ name: '音乐人' }], album: { id: 9, name: '夜间收藏', picUrl: '' } }))
async function login(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('yunplex2-theme', 'light')
    localStorage.setItem('yunplex-manual-parse-history', JSON.stringify([{ id: 'playlist:123', input: 'https://music.163.com/playlist?id=123', type: 'playlist', title: '夜间收藏', coverUrl: '', trackCount: 3, parsedAt: new Date().toISOString() }]))
  })
  await page.goto('/login')
  await page.getByLabel('管理员密码', { exact: true }).fill('browser-test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL('/')
}
for (const width of [1440, 390]) {
  test(`manual import has coherent steps, controls and submission at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    await login(page)
    let parseFail = false
    let submitFail = true
    let postCount = 0
    await page.route('**/api/netease/playlist-songs**', route => route.fulfill({ json: parseFail ? { code: 1, msg: '链接暂时不可用', data: null } : ok({ songs, trackUpdateTime: 1, playlistName: '夜间收藏', playlist: { name: '夜间收藏', creatorName: '音乐人', coverUrl: '', description: '', updateTime: 1 } }) }))
    await page.route('**/api/download', route => {
      postCount++
      expect(route.request().postDataJSON().songIds).toEqual([1, 3])
      return route.fulfill({ json: submitFail ? { code: 1, msg: '服务暂时不可用', data: null } : ok({ batchId: 'test-import', total: 2, selectionFailures: [] }) })
    })
    await page.goto('/manual-download')
    const steps = page.getByRole('list', { name: '添加音乐步骤' })
    await expect(steps.locator('li')).toHaveCount(3)
    await expect(steps.locator('.manual-steps__arrow')).toHaveCount(2)
    await expect(steps.locator('li').first()).toHaveAttribute('aria-current', 'step')
    await expect(page.getByRole('button', { name: '解析并预览' })).toBeDisabled()
    const typeIssues = await page.locator('.manual-page').evaluate(root => Array.from(root.querySelectorAll<HTMLElement>('h2,h3,p,.btn,textarea')).filter(node => node.getClientRects().length).flatMap(node => {
      const style = getComputedStyle(node)
      const expected = node.tagName === 'H2' ? 18 : node.tagName === 'H3' ? 16 : null
      const errors: string[] = []
      if (expected && (parseFloat(style.fontSize) !== expected || style.fontWeight !== '600')) errors.push(`${node.tagName}: ${style.fontSize}/${style.fontWeight}`)
      if (node.tagName === 'P' && (![12, 13, 14].includes(parseFloat(style.fontSize)) || Math.abs(parseFloat(style.lineHeight) / parseFloat(style.fontSize) - 1.6) > .01)) errors.push(`body: ${style.fontSize}/${style.lineHeight}`)
      if (node.matches('.btn') && (style.fontSize !== '14px' || node.getBoundingClientRect().height < (innerWidth < 768 ? 44 : 40))) errors.push(`control: ${style.fontSize}/${node.getBoundingClientRect().height}`)
      return errors
    }))
    expect(typeIssues).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: testInfo.outputPath('input-light.png'), fullPage: true, animations: 'disabled' })
    await page.getByText('输入帮助', { exact: true }).click()
    await expect(page.locator('.manual-help p')).toBeVisible()
    await page.getByText('输入帮助', { exact: true }).click()
    await page.locator('.manual-options-summary').click()
    await expect(page.getByRole('combobox', { name: '选择下载音质' })).toHaveCSS('font-size', '14px')
    expect((await page.getByRole('combobox', { name: '选择下载音质' }).boundingBox())!.height).toBeGreaterThanOrEqual(width < 720 ? 44 : 40)
    await page.locator('.manual-options-summary').click()

    parseFail = true
    await page.getByLabel('网易云链接、歌单 ID、专辑 ID 或歌曲 ID').fill('https://music.163.com/playlist?id=123')
    await page.getByRole('button', { name: '解析并预览' }).click()
    await expect(steps.locator('li').first()).toHaveClass(/is-error/)
    await expect(page.getByRole('alert')).toContainText('链接暂时不可用')
    parseFail = false
    await page.getByRole('button', { name: '解析并预览' }).click()
    await expect(steps.locator('li').first()).toHaveClass(/is-success/)
    await expect(steps.locator('li').nth(1)).toHaveAttribute('aria-current', 'step')
    await expect(page.getByRole('button', { name: '下载 3 首', exact: true })).toHaveCount(1)
    await page.getByLabel('选择 第二首歌曲').uncheck()
    await page.getByRole('button', { name: '修改链接' }).click()
    await page.getByLabel('网易云链接、歌单 ID、专辑 ID 或歌曲 ID').fill('https://music.163.com/playlist?id=456')
    await expect(page.getByRole('button', { name: '下载 2 首' })).toBeDisabled()
    await expect(steps.locator('li').first()).toContainText('需要重新解析')
    await page.getByLabel('网易云链接、歌单 ID、专辑 ID 或歌曲 ID').fill('https://music.163.com/playlist?id=123')
    await page.getByRole('button', { name: '收起输入' }).click()
    await expect(page.getByRole('button', { name: '下载 2 首' })).toBeEnabled()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    if (width < 720) {
      const markers = await steps.locator('.manual-steps__marker').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().top))
      expect(Math.max(...markers) - Math.min(...markers)).toBeLessThan(1)
      await expect(page.locator('.manual-track-table tbody td:nth-child(6)').first()).toHaveCSS('white-space', 'nowrap')
    }
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: testInfo.outputPath('confirmation-light.png'), fullPage: true, animations: 'disabled' })
    await page.getByRole('button', { name: '下载 2 首' }).click()
    await expect(steps.locator('li').nth(2)).toHaveClass(/is-error/)
    await expect(page.getByRole('alert')).toContainText('提交失败')
    submitFail = false
    await page.getByRole('button', { name: '下载 2 首' }).click()
    await expect(steps.locator('li').nth(2)).toHaveClass(/is-success/)
    await expect(page.getByRole('heading', { name: '已提交 2 首歌曲' })).toBeVisible()
    await expect(page.getByRole('button', { name: '下载 2 首' })).toHaveCount(0)
    expect(postCount).toBe(2)
    await page.getByRole('button', { name: '切换到深色主题' }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: testInfo.outputPath('submitted-dark.png'), fullPage: true, animations: 'disabled' })
    await page.getByRole('button', { name: '继续添加' }).click()
    await expect(page.getByLabel('网易云链接、歌单 ID、专辑 ID 或歌曲 ID')).toHaveValue('')
    await expect(steps.locator('li').first()).toHaveAttribute('aria-current', 'step')
  })
}
