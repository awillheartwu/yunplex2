import { expect, test, type Page } from './fixtures'

const ok = (data: unknown) => ({ code: 0, msg: 'ok', data })
async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('管理员密码', { exact: true }).fill('browser-test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible()
}

for (const width of [375,1440]) {
  test(`current candidate can be adopted directly and retried at ${width}px`, async ({page}) => {
    await page.setViewportSize({width,height:900})
    await login(page)
    const source = { id: 'style-owner', name: '样式独立加载', neteasePlaylistName: '样式独立加载', neteasePlaylistId: 123, type: 'playlist', enabled: true, subscribed: false, coverUrl: '', trackCount: 1, plexPlaylistName: '目标', plexPlaylistRatingKey: 'target', lastStatus: 'idle', lastSyncedAt: null, initializationStatus: 'awaiting_review', initializationTotalItems: 1 }
    const initialization = { id: 'style-review', sourceId: source.id, status: 'awaiting_review', ruleVersion: 1, rulesCompatible: true, matchingConfig: { config: { enabled: true } }, totalItems: 1, preservedItems: 0, strongItems: 0, highConfidenceItems: 1, possibleItems: 0, ambiguousItems: 0, unmatchedItems: 0, adoptItems: 0, downloadItems: 0, deferredItems: 1, conflictItems: 0, createdAt: '2026-09-08', updatedAt: '2026-09-08' }
    const item = { initializationId: initialization.id, neteaseSongId: 1, position: 0, occurrenceCount: 1, title: '很长的歌曲名称与副标题 · Live Session', artists: ['测试艺人'], album: '专辑', tier: 'high_confidence', candidate: { ratingKey: 'candidate', title: 'Plex 候选', artist: '艺人', album: '专辑', filePath: '/music/artist/album/a-long-file-name.flac' }, candidates: [], evidence: { rule: 'strict_local_metadata' }, expectedBindingUpdatedAt: null, decisionStatus: 'proposed', kind: 'actionable', decision: 'defer', allowedDecisions: ['adopt', 'download', 'defer'], canSearch: true, unavailableReason: null }


    const current = {...item,tier:'possible',allowedDecisions:['adopt','download','defer']}
    await page.route('**/api/playlist-sources/style-owner',route=>route.fulfill({json:ok(source)}))
    await page.route('**/api/playlist-sources/style-owner/initialization',route=>route.fulfill({json:ok({applicable:true,initialization,downloadConcurrency:3,convergenceQueueDepth:0})}))
    await page.route('**/api/playlist-sources/style-owner/initialization/items**',route=>route.fulfill({json:ok({items:[current],total:1,page:1,pageSize:50})}))
    await page.route('**/api/runs**',route=>route.fulfill({json:ok({items:[],total:0})}))
    let attempts=0
    await page.route('**/api/playlist-sources/style-owner/initialization/decisions',async route=>{
      attempts++
      expect(route.request().postDataJSON()).toEqual({initializationId:initialization.id,songIds:[1],decision:'adopt'})
      await route.fulfill({json:attempts===1?{code:1,msg:'更新草案失败，请重试',data:null}:ok({changed:1})})
    })
    await page.goto('/sync-sources/style-owner?tab=initialization')
    await page.getByRole('button',{name:'查看证据',exact:true}).click()
    const drawer=page.getByRole('dialog',{name:`${item.title} 证据详情`})
    await drawer.getByRole('button',{name:'使用当前候选',exact:true}).click()
    await expect(drawer.getByRole('alert')).toContainText('更新草案失败')
    await expect(drawer.getByRole('button',{name:'使用当前候选',exact:true})).toBeEnabled()
    await drawer.screenshot({path:`/tmp/direct-candidate-${width}.png`})
    expect(await drawer.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true)
    await drawer.getByRole('button',{name:'使用当前候选',exact:true}).click()
    await expect(drawer).toHaveCount(0)
    expect(attempts).toBe(2)
  })
}
