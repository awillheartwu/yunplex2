import { expect, test } from './fixtures'

test('light and dark themes keep text readable and share the same control and type scales', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByLabel('管理员密码', { exact: true })).toBeVisible()
  for (const dark of [false, true]) {
    const result = await page.evaluate(dark => {
      document.documentElement.classList.toggle('dark', dark)
      const host = document.createElement('div')
      host.setAttribute('aria-hidden', 'true')
      host.style.cssText = 'position:fixed;left:-1000px;top:0'
      document.body.append(host)
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1
      const context = canvas.getContext('2d')!
      function rgb(color: string) {
        context.clearRect(0, 0, 1, 1)
        context.fillStyle = color
        context.fillRect(0, 0, 1, 1)
        return [...context.getImageData(0, 0, 1, 1).data]
      }
      function luminance(color: number[]) {
        return color.slice(0, 3).reduce((total, value, index) => {
          const c = value / 255
          return total + (c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][index]!
        }, 0)
      }
      const probe = document.createElement('span')
      host.append(probe)
      function color(token: string) {
        probe.style.color = `var(--${token})`
        return rgb(getComputedStyle(probe).color)
      }
      function contrast(foreground: number[], background: number[]) {
        const [a, b] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
        return (a! + .05) / (b! + .05)
      }
      const pairs: { pair: string; ratio: number }[] = []
      for (const background of ['bg-app', 'bg-sidebar', 'bg-surface', 'bg-elevated', 'bg-input']) {
        for (const foreground of ['text-primary', 'text-secondary', 'text-tertiary']) {
          pairs.push({ pair: `${foreground}/${background}`, ratio: contrast(color(foreground), color(background)) })
        }
      }
      for (const semantic of ['accent', 'success', 'existing', 'ignored', 'warning', 'danger', 'running', 'run-sync', 'run-download', 'run-repair']) {
        const soft = color(`${semantic}-${semantic === 'accent' ? 'muted' : 'soft'}`)
        const surface = color('bg-surface')
        const background = soft.slice(0, 3).map((value, i) => value * soft[3]! / 255 + surface[i]! * (1 - soft[3]! / 255))
        pairs.push({ pair: `${semantic}/soft`, ratio: contrast(color(semantic), background) })
      }
      pairs.push({ pair: 'on-accent/accent', ratio: contrast(color('on-accent'), color('accent')) })
      pairs.push({ pair: 'on-accent/accent-strong', ratio: contrast(color('on-accent'), color('accent-strong')) })
      const danger = color('danger')
      host.innerHTML = '<button class="btn">Action</button><input class="form-input"><span class="text-base font-sans">Body</span><span class="text-xs">Caption</span><svg class="app-icon hidden text-danger"></svg>'
      const [button, input, body, caption, icon] = [...host.children].map(element => getComputedStyle(element))
      const sizes = { button: button!.fontSize, input: input!.fontSize, body: body!.fontSize, caption: caption!.fontSize, height: button!.minHeight, family: body!.fontFamily, iconDisplay: icon!.display, iconColor: rgb(icon!.color), danger }
      host.remove()
      return { pairs, sizes }
    }, dark)
    for (const pair of result.pairs) expect.soft(pair.ratio, `${dark ? 'dark' : 'light'} ${pair.pair}`).toBeGreaterThanOrEqual(4.5)
    expect(result.sizes.button).toBe(result.sizes.input)
    expect(result.sizes.button).toBe(result.sizes.body)
    expect(result.sizes.caption).toBe('12px')
    expect(parseFloat(result.sizes.height)).toBeGreaterThanOrEqual(40)
    expect(result.sizes.family).toContain('PingFang SC')
    expect(result.sizes.iconDisplay).toBe('none')
    expect(result.sizes.iconColor).toEqual(result.sizes.danger)
  }
})

for (const viewport of [{ width: 375, height: 812, scale: 1.25 }, { width: 375, height: 812, scale: 1.5 }, { width: 1440, height: 900, scale: 1 }]) {
  test(`workspace pages respect the type scale and viewport at ${viewport.width}px / ${viewport.scale}x`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/')
    await page.getByLabel('管理员密码', { exact: true }).fill('browser-test-password')
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible()
    for (const [path, title] of [['/', '工作台'], ['/sync-sources', '音乐库'], ['/manual-download', '添加音乐'], ['/task-center', '活动'], ['/config', '偏好设置'], ['/system', '系统状态']]) {
      await page.goto(path!)
      await expect(page.getByRole('heading', { name: title!, exact: true })).toBeVisible()
      await page.evaluate(scale => document.documentElement.style.setProperty('--font-scale', String(scale)), viewport.scale)
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth), { message: path }).toBeLessThanOrEqual(1)
      expect(await page.locator('html').evaluate(element => getComputedStyle(element).fontSize)).toBe(`${16 * viewport.scale}px`)
      if (viewport.width < 768) {
        const dock = page.getByRole('navigation', { name: '快捷导航', exact: true })
        await expect(dock).toBeInViewport()
        const dockBox = (await dock.boundingBox())!
        expect(dockBox.y + dockBox.height).toBeLessThanOrEqual(viewport.height + 1)
        if (path === '/config') {
          const savebar = page.locator('.config-savebar')
          await savebar.scrollIntoViewIfNeeded()
          const box = (await savebar.boundingBox())!
          expect(box.y + box.height).toBeLessThanOrEqual(dockBox.y)
        }
      }
    }
  })
}
