import { expect, test, type Page } from './fixtures'

const ok = (data: unknown) => ({ code: 0, msg: 'ok', data })
async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('管理员密码', { exact: true }).fill('browser-test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible()
}

for (const width of [375, 1440]) {
  test(`shared-media confirmation is explicit and recovers from failure at ${width}px`, async ({ page }) => {
    await page.setViewportSize({width,height:900})
    await login(page)
    const source = { id: 'style-owner', name: '样式独立加载', neteasePlaylistName: '样式独立加载', neteasePlaylistId: 123, type: 'playlist', enabled: true, subscribed: false, coverUrl: '', trackCount: 1, plexPlaylistName: '目标', plexPlaylistRatingKey: 'target', lastStatus: 'idle', lastSyncedAt: null, initializationStatus: 'awaiting_review', initializationTotalItems: 1 }
    const initialization = { id: 'style-review', sourceId: source.id, status: 'awaiting_review', ruleVersion: 1, rulesCompatible: true, matchingConfig: { config: { enabled: true } }, totalItems: 1, preservedItems: 0, strongItems: 0, highConfidenceItems: 1, possibleItems: 0, ambiguousItems: 0, unmatchedItems: 0, adoptItems: 0, downloadItems: 0, deferredItems: 1, conflictItems: 0, createdAt: '2026-09-08', updatedAt: '2026-09-08' }
    const item = { initializationId: initialization.id, neteaseSongId: 1, position: 0, occurrenceCount: 1, title: '很长的歌曲名称与副标题 · Live Session', artists: ['测试艺人'], album: '专辑', tier: 'high_confidence', candidate: { ratingKey: 'candidate', title: 'Plex 候选', artist: '艺人', album: '专辑', filePath: '/music/artist/album/a-long-file-name.flac' }, candidates: [], evidence: { rule: 'strict_local_metadata' }, expectedBindingUpdatedAt: null, decisionStatus: 'proposed', kind: 'actionable', decision: 'defer', allowedDecisions: ['adopt', 'download', 'defer'], canSearch: true, unavailableReason: null }

    const review = { ratingKey:'candidate',filePath:'/music/shared.flac',songs:[
      {songId:1,title:'the cure',artists:['Olivia Rodrigo'],album:'the cure',durationMs:297090,bindingVersion:null},
      {songId:2,title:'the cure',artists:['Olivia Rodrigo'],album:'the cure',durationMs:297127,bindingVersion:null},
    ] }
    const sharedItem = {...item,candidate:null,tier:'ambiguous',evidence:{rule:'enhanced_metadata',classification:'shared_media',sharedMedia:review,sharedMediaFingerprint:'snapshot-proof',reasons:['标题与艺人一致'],conflicts:[]}}
    await page.route('**/api/playlist-sources/style-owner',route=>route.fulfill({json:ok(source)}))
    await page.route('**/api/playlist-sources/style-owner/initialization',route=>route.fulfill({json:ok({applicable:true,initialization,downloadConcurrency:3,convergenceQueueDepth:0})}))
    await page.route('**/api/playlist-sources/style-owner/initialization/items**',route=>route.fulfill({json:ok({items:[sharedItem],total:1,page:1,pageSize:50})}))
    await page.route('**/api/runs**',route=>route.fulfill({json:ok({items:[],total:0})}))
    let requests = 0
    await page.route('**/api/playlist-sources/style-owner/initialization/shared-media',async route=>{
      requests++
      expect(route.request().postDataJSON()).toEqual({initializationId:initialization.id,songId:1,fingerprint:'snapshot-proof'})
      await route.fulfill({json:requests===1?{code:1,msg:'共享方案已变化',data:null}:ok({changed:2})})
    })
    await page.goto('/sync-sources/style-owner?tab=initialization')
    await page.getByRole('button',{name:'查看证据',exact:true}).click()
    const drawer = page.getByRole('dialog',{name:`${item.title} 证据详情`})
    await expect(drawer).toContainText('297.090 秒')
    await expect(drawer).toContainText('297.127 秒')
    await expect(drawer).toContainText('共享媒体待确认')
    expect(requests).toBe(0)
    await drawer.getByRole('button',{name:'确认这 2 首共用媒体'}).click()
    await page.getByRole('button',{name:'取消',exact:true}).click()
    expect(requests).toBe(0)
    await drawer.getByRole('button',{name:'确认这 2 首共用媒体'}).click()
    await page.getByRole('button',{name:'确认共用并更新草案'}).click()
    await expect(drawer.getByRole('alert')).toContainText('共享方案已变化')
    await drawer.screenshot({path:`/tmp/shared-review-${width}.png`})
    expect(await drawer.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true)
    await drawer.getByRole('button',{name:'确认这 2 首共用媒体'}).click()
    await page.getByRole('button',{name:'确认共用并更新草案'}).click()
    await expect(drawer).toHaveCount(0)
    expect(requests).toBe(2)
  })
}
