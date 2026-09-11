import { expect, test, type Page } from './fixtures'

const PASSWORD = 'browser-test-password'

async function login(page: Page): Promise<void> {
  await page.goto('/')
  const passwordField = page.getByLabel('管理员密码')
  await expect(passwordField.or(page.getByRole('heading', { name: '工作台', exact: true }))).toBeVisible()
  if (await passwordField.isVisible()) {
    await passwordField.fill(PASSWORD)
    await page.getByRole('button', { name: '登录' }).click()
    await expect(page).toHaveURL('/')
  }
  await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible()
}

function ok(data: unknown) {
  return { code: 0, msg: 'ok', data }
}

function initializationFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'init-browser', sourceId: 'source-browser', runId: null, followUpRunId: null, trigger: 'user', status: 'awaiting_review',
    ruleVersion: 1, rulesCompatible: true, requestId: null, requestStatus: null, neteaseCursor: null, plexFingerprint: null,
    totalItems: 1, preservedItems: 0, strongItems: 0, highConfidenceItems: 1, possibleItems: 0, ambiguousItems: 0,
    unmatchedItems: 0, adoptItems: 0, downloadItems: 0, deferredItems: 1, conflictItems: 0, summary: '', error: null,
    createdAt: '2026-08-29T00:00:00.000Z', startedAt: null, analyzedAt: '2026-08-29T00:00:00.000Z', completedAt: null,
    updatedAt: '2026-08-29T00:00:00.000Z', ...overrides,
  }
}

function actionableInitializationItem(id: number, overrides: Record<string, unknown> = {}) {
  return {
    initializationId: 'init-browser', neteaseSongId: id, position: 0, occurrenceCount: 1, title: `歌曲 ${id}`, artists: ['测试艺人'], album: '测试专辑',
    trackNumber: 1, durationMs: 180000, tier: 'high_confidence',
    candidate: { ratingKey: `plex-${id}`, title: `歌曲 ${id}`, artist: '测试艺人', album: '测试专辑', durationMs: 180000, trackNumber: 1, filePath: `/music/${id}.flac` },
    candidates: [], evidence: { rule: 'strict_local_metadata' }, expectedBindingUpdatedAt: null, decisionStatus: 'proposed', kind: 'actionable',
    decision: 'defer', allowedDecisions: ['adopt', 'download', 'defer'], canSearch: true, unavailableReason: null, ...overrides,
  }
}

function preservedInitializationItem(overrides: Record<string, unknown> = {}) {
  return {
    ...actionableInitializationItem(421423806, {
      title: '小半', artists: ['陈粒'], album: '小梦大半', tier: 'preserved', decision: null,
      candidate: { ratingKey: '46098', title: '小半', artist: 'Chen Li', album: '小梦大半 (Reams of Dream)', durationMs: 180000, trackNumber: 1, filePath: '/music/03 - 小半 [netease-421423806].flac' },
      evidence: { rule: 'active_binding_verified', bindingMethod: 'path' }, kind: 'preserved', allowedDecisions: [], canSearch: false, unavailableReason: '保留已验证绑定，无需重新选择',
    }),
    ...overrides,
  }
}

const source = {
  id: 'source-browser',
  neteasePlaylistId: 1001,
  name: '浏览器验收歌单',
  neteasePlaylistName: '浏览器验收歌单',
  type: 'playlist',
  subscribed: false,
  enabled: true,
  coverUrl: '',
  plexPlaylistName: '浏览器验收歌单',
  plexPlaylistRatingKey: 'playlist-1',
  syncLimit: null,
  lastSyncedAt: '2026-08-29T00:00:00.000Z',
  lastStatus: 'partial',
  lastError: null,
  lastJobId: null,
  autoCreatePlexPlaylist: false,
  trackCount: 1,
  lastTrackUpdateTime: null,
  forceFullCompare: null,
  consecutiveSkips: 0,
  fullCompareAfterSkips: null,
  fullCompareAfterDays: null,
  lastFullCompareAt: null,
  plexUpdatedAt: null,
  trackIdSnapshot: null,
  lastObservedPlexFingerprint: null,
  lastAppliedPlexFingerprint: null,
  lastObservedNeteaseCursor: null,
  lastComparedNeteaseCursor: null,
  lastObservedAt: null,
  lastComparedAt: null,
  skipPlexPlaylist: null,
  skipRemoveExtraTracks: null,
  actionableFailureCount: 0,
  copyrightRestrictedCount: 0,
  requiresMatchReconcile: true,
  syncIntervalMinutes: null,
  nextSyncAt: null,
  lastScheduleStatus: 'idle',
  lastScheduledAt: null,
  lastScheduleError: null,
  sortOrder: 0,
  createdAt: '2026-08-29T00:00:00.000Z',
  updatedAt: '2026-08-29T00:00:00.000Z',
}

const awaitingManualItem = {
  target: {
    neteaseSongId: 101,
    title: '等待选择的歌曲',
    artists: ['测试艺人'],
    albumName: '测试专辑',
    coverUrl: '',
    metadataSource: 'occurrence',
  },
  occurrence: {
    id: 'source-browser:101:0',
    sourceId: 'source-browser',
    neteaseSongId: 101,
    occurrence: 0,
    position: 0,
    title: '等待选择的歌曲',
    artists: ['测试艺人'],
    albumId: 9,
    albumName: '测试专辑',
    coverUrl: '',
    trackNumber: 1,
    discNumber: 1,
    durationMs: 180000,
    metadataComplete: true,
    membershipStatus: 'current',
    removalReason: null,
    lastSongStatus: 'awaiting_manual_match',
    lastRunId: null,
    matchTrace: null,
    lastError: null,
    alignmentStatus: 'pending',
    alignedPlexRatingKey: null,
    alignedPlexRelativePath: null,
    alignedBindingUpdatedAt: null,
    alignedAt: null,
    firstObservedAt: '2026-08-29T00:00:00.000Z',
    lastObservedAt: '2026-08-29T00:00:00.000Z',
    removedAt: null,
  },
  binding: null,
  localMedia: null,
  state: 'awaiting_manual',
  affectedSources: [{ id: 'source-browser', name: '浏览器验收歌单' }],
}

async function mockSourceMedia(page: Page): Promise<void> {
  await page.route('**/api/playlist-sources**', async route => {
    if (route.request().method() === 'GET') {
      const pathname = new URL(route.request().url()).pathname
      await route.fulfill({ json: ok(pathname === '/api/playlist-sources/source-browser' ? source : [source]) })
      return
    }
    await route.continue()
  })
  await page.route('**/api/match-management/overview**', route => route.fulfill({
    json: ok({
      items: [awaitingManualItem],
      total: 1,
      page: 1,
      pageSize: 25,
      staleAfterMinutes: 10,
    }),
  }))
  await page.route('**/api/match-management/plex-search**', route => route.fulfill({
    json: ok({
      tracks: [{
        ratingKey: 'plex-101',
        title: '刮削器重命名后的标题',
        artist: 'Plex 艺人',
        album: 'Plex 专辑',
        plexFilePath: '/music/external/101.flac',
      }],
    }),
  }))
  await page.route('**/api/runs**', route => route.fulfill({ json: ok({ items: [], total: 0 }) }))
}

async function mockInitializationReview(page: Page, initialization: Record<string, unknown>, items: unknown[]): Promise<void> {
  await page.route('**/api/playlist-sources/source-browser', route => route.fulfill({ json: ok({ ...source, initializationStatus: initialization.status, initializationTotalItems: initialization.totalItems }) }))
  await page.route('**/api/playlist-sources/source-browser/initialization/items**', route => route.fulfill({
    json: ok({ items, total: items.length, page: 1, pageSize: 50 }),
  }))
  await page.route('**/api/playlist-sources/source-browser/initialization', route => route.fulfill({
    json: ok({ applicable: true, initialization, downloadConcurrency: 3, convergenceQueueDepth: 0 }),
  }))
  await page.route('**/api/runs**', route => route.fulfill({ json: ok({ items: [], total: 0 }) }))
}

async function mockDashboardShell(page: Page, syncResponse: Record<string, unknown>): Promise<void> {
  await page.route('**/api/dashboard/summary', route => route.fulfill({
    json: ok({
      status: {
        overallTone: 'neutral', overallLabel: '测试环境', items: [], lastSyncAt: null,
        autoSyncEnabled: false, syncRunning: false,
      },
      pendingItems: [],
      sourceHealth: { total: 0, normal: 0, warning: 0, failed: 0, unsynced: 0 },
      downloadTrend: [],
    }),
  }))
  await page.route('**/api/config', route => route.fulfill({
    json: ok({ sync: { enabled: false } }),
  }))
  await page.route('**/api/sync/status', route => route.fulfill({
    json: ok({
      isRunning: false, currentStage: 'idle', startedAt: null, currentSourceName: null,
      lastSyncAt: null, lastSyncResult: null, syncCount: 0, successCount: 0, failureCount: 0,
      currentSong: null, progress: null, failures: [], dryRun: false,
    }),
  }))
  await page.route('**/api/system/info', route => route.fulfill({ json: ok({ version: 'browser-test' }) }))
  await page.route('**/api/system/stats', route => route.fulfill({
    json: ok({
      cpu: 1, mem: { rss: 1, heapUsed: 1, heapTotal: 1, external: 1 }, uptime: 1, pid: 1,
      dbSize: 1, plexOk: false, neteaseOk: false, dirWritable: true, timestamp: 1,
      scheduler: { enabled: false, scheduled: false, heartbeatAt: null, queueDepth: 0, runningCount: 0, oldestQueuedAt: null, nextSyncAt: null, lastError: null },
    }),
  }))
  await page.route('**/api/sync/trigger', async route => {
    expect(route.request().postDataJSON()).toEqual({ mode: 'normal' })
    await route.fulfill({ json: ok(syncResponse) })
  })
}

test('authentication and primary navigation work in a real browser', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login\?redirect=/)
  await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible()

  await page.getByLabel('管理员密码').fill('wrong-password')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByRole('alert')).toContainText('密码错误')

  await page.getByLabel('管理员密码').fill(PASSWORD)
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible()

  for (const [label, path] of [
    ['音乐库', '/sync-sources'],
    ['添加音乐', '/manual-download'],
    ['活动', '/task-center'],
    ['偏好设置', '/config'],
    ['系统状态', '/system'],
  ] as const) {
    await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name: label, exact: true }).click()
    await expect(page).toHaveURL(path)
    await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible()
  }
})

test('manual playlist download keeps resource identity for partial selection and shows drift failures', async ({ page }) => {
  await login(page)
  await page.route('**/api/netease/playlist-songs**', route => route.fulfill({
    json: ok({
      songs: [
        { id: 201, name: '第一首', no: 1, dt: 180000, disc: '1', artists: [{ name: '艺人' }], album: { id: 9, name: '专辑', picUrl: '' } },
        { id: 202, name: '第二首', no: 2, dt: 181000, disc: '1', artists: [{ name: '艺人' }], album: { id: 9, name: '专辑', picUrl: '' } },
        { id: 203, name: '第三首', no: 3, dt: 182000, disc: '1', artists: [{ name: '艺人' }], album: { id: 9, name: '专辑', picUrl: '' } },
      ],
      trackUpdateTime: 1,
      trackIds: [{ id: 201 }, { id: 202 }, { id: 203 }],
      playlistName: '部分选择测试歌单',
      playlist: {
        name: '部分选择测试歌单', coverUrl: '', creatorName: '测试用户',
        description: '', trackCount: 3, updateTime: 1,
      },
    }),
  }))
  let submitted: Record<string, unknown> | null = null
  await page.route('**/api/download', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    submitted = route.request().postDataJSON() as Record<string, unknown>
    return route.fulfill({
      json: ok({
        batchId: 'manual-partial',
        total: 1,
        selectionFailures: [{ songId: 203, reason: '歌曲不在最新资源快照中' }],
      }),
    })
  })

  await page.goto('/manual-download')
  await page.getByLabel('网易云链接、歌单 ID、专辑 ID 或歌曲 ID').fill('https://music.163.com/playlist?id=9988')
  await page.getByRole('button', { name: '解析并预览' }).click()
  await expect(page.getByTitle('部分选择测试歌单')).toBeVisible()
  await page.getByLabel('选择 第二首').uncheck()
  await page.getByRole('button', { name: '下载 2 首' }).click()

  await expect.poll(() => submitted).toEqual(expect.objectContaining({
    type: 'playlist',
    neteaseId: 9988,
    songIds: [201, 203],
  }))
  await expect(page.getByText('1 首歌曲未能加入')).toBeVisible()
  await expect(page.getByText(/ID 203/)).toBeVisible()
})

test('download and save creates one disabled-source command without starting a separate download', async ({ page }) => {
  await login(page)
  await page.route('**/api/netease/playlist-songs**', route => route.fulfill({
    json: ok({
      songs: [
        { id: 301, name: '托管歌曲', no: 1, dt: 180000, disc: '1', artists: [{ name: '艺人' }], album: { id: 10, name: '专辑', picUrl: '' } },
      ],
      trackUpdateTime: 1,
      trackIds: [{ id: 301 }],
      playlistName: '待托管歌单',
      playlist: {
        name: '待托管歌单', coverUrl: '', creatorName: '测试用户',
        description: '', trackCount: 1, updateTime: 1,
      },
    }),
  }))
  let ordinaryDownloadRequests = 0
  let sourceCommand: Record<string, unknown> | null = null
  await page.route('**/api/download', async route => {
    if (route.request().method() === 'POST') ordinaryDownloadRequests++
    await route.fulfill({ json: ok({ batchId: 'unexpected', total: 1, selectionFailures: [] }) })
  })
  await page.route('**/api/manual-download/save-as-source', async route => {
    sourceCommand = route.request().postDataJSON() as Record<string, unknown>
    await route.fulfill({
      json: ok({ sourceId: 'source-disabled', batchId: 'managed-run', total: 1, selectionFailures: [] }),
    })
  })

  await page.goto('/manual-download')
  await page.getByLabel('网易云链接、歌单 ID、专辑 ID 或歌曲 ID').fill('https://music.163.com/playlist?id=8877')
  await page.getByRole('button', { name: '解析并预览' }).click()
  await page.getByRole('button', { name: '下载并保存为同步源' }).click()

  await expect.poll(() => sourceCommand).toEqual(expect.objectContaining({
    type: 'playlist',
    neteaseId: 8877,
    selectedSongIds: [301],
    name: '待托管歌单',
  }))
  expect(ordinaryDownloadRequests).toBe(0)
  await expect(page.locator('.toast-region')).toContainText('已创建禁用的同步源')
})

test('awaiting-manual media supports managed download and Explicit Adoption', async ({ page }) => {
  await login(page)
  await mockSourceMedia(page)

  let managedDownloadRequested = false
  let explicitAdoptionRequested = false
  await page.route('**/api/playlist-sources/source-browser/songs/101/download-managed', route => {
    managedDownloadRequested = true
    return route.fulfill({ json: ok({ batchId: 'batch-101', total: 1 }) })
  })
  await page.route('**/api/match-management/bindings/101/rebind', route => {
    explicitAdoptionRequested = true
    return route.fulfill({ json: ok({ neteaseSongId: 101 }) })
  })

  await page.goto('/sync-sources')
  await expect(page.locator('.collection-item__title', { hasText: '浏览器验收歌单' })).toBeVisible()
  await page.getByRole('link', { name: '打开 浏览器验收歌单' }).click()
  await page.getByRole('tab', { name: '歌曲与媒体' }).click()

  await expect(page.locator('.source-media__state', { hasText: '等待手动选择' })).toBeVisible()
  await page.getByRole('button', { name: '下载并托管' }).click()
  await expect.poll(() => managedDownloadRequested).toBe(true)
  await expect(page.locator('.toast-region')).toContainText('已加入托管下载队列')

  await page.getByRole('button', { name: '使用 Plex 媒体' }).click()
  await expect(page.getByText('刮削器重命名后的标题')).toBeVisible()
  await page.getByRole('button', { name: '选择' }).click()
  await expect(page.getByRole('dialog', { name: '确认使用 Plex 媒体' })).toBeVisible()
  await page.getByRole('button', { name: '保存关联' }).click()
  await expect.poll(() => explicitAdoptionRequested).toBe(true)
  await expect(page.locator('.toast-region')).toContainText('Plex 媒体关联已保存')
})

test('mobile source view has no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await login(page)
  await mockSourceMedia(page)
  await page.goto('/sync-sources')
  await expect(page.locator('.collection-item__title', { hasText: '浏览器验收歌单' })).toBeVisible()

  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }))
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport)
  await expect(page.getByRole('button', { name: '打开导航' })).toBeVisible()
})

test('source detail settings keep override controls readable on desktop and mobile', async ({ page }, testInfo) => {
  await login(page)
  await mockSourceMedia(page)
  await page.route('**/api/config', route => route.fulfill({
    json: ok({
      sync: {
        initializeMediaOnFirstSync: true,
        forceFullCompare: false,
        skipRemoveExtraTracks: false,
        skipPlexPlaylist: false,
      },
    }),
  }))
  await page.route('**/api/playlist-sources/source-browser/initialization', route => route.fulfill({
    json: ok({
      applicable: true,
      initialization: initializationFixture({ id: 'pending-browser', status: 'pending', totalItems: 0, highConfidenceItems: 0, deferredItems: 0, requestStatus: null }),
      downloadConcurrency: 3,
      convergenceQueueDepth: 0,
    }),
  }))

  await page.goto('/sync-sources/source-browser?tab=settings')
  await expect(page.getByRole('link', { name: '返回', exact: true })).toBeVisible()
  await expect(page.locator('.source-boolean-override')).toHaveCount(3)

  if (process.env.UI_SCREENSHOTS === '1') await page.screenshot({ path: testInfo.outputPath('source-settings-desktop.png'), fullPage: true })
  const desktopOverrides = await page.locator('.source-boolean-override').evaluateAll(elements => elements.map(element => {
    const copy = element.children[0]!
    const select = element.children[1]!
    return {
      height: element.getBoundingClientRect().height,
      copyWidth: copy.getBoundingClientRect().width,
      selectWidth: select.getBoundingClientRect().width,
    }
  }))
  for (const item of desktopOverrides) {
    expect(item.height).toBeLessThan(80)
    expect(item.copyWidth).toBeGreaterThan(200)
    expect(item.selectWidth).toBeGreaterThan(100)
  }

  await page.setViewportSize({ width: 375, height: 812 })
  await expect(page.getByText('首次同步前媒体接管', { exact: true })).toBeVisible()
  for (const tab of ['概览', '首次媒体接管', '歌曲与媒体', '运行记录', '设置']) {
    await page.getByRole('tab', { name: tab, exact: true }).click()
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }))
    expect(dimensions.content, tab).toBeLessThanOrEqual(dimensions.viewport)
    if (tab === '概览') await expect(page.locator('.source-detail__summary .sync-hover-card__stats')).toHaveCSS('display', 'flex')
    if (process.env.UI_SCREENSHOTS === '1') await page.screenshot({ path: testInfo.outputPath(`source-mobile-${tab}.png`), fullPage: true })
  }
})

test('first media adoption handles a 3450-song review with cross-page selection', async ({ page }) => {
  await login(page)
  const initialization = initializationFixture({
    totalItems: 3450, preservedItems: 920,
    strongItems: 410, highConfidenceItems: 780, possibleItems: 460, ambiguousItems: 330,
    unmatchedItems: 550, adoptItems: 410, downloadItems: 0, deferredItems: 3040,
  })
  const item = (id: number) => actionableInitializationItem(id, {
    initializationId: 'init-browser',
  })
  await page.route('**/api/playlist-sources/source-browser/initialization/items**', route => {
    const currentPage = Number(new URL(route.request().url()).searchParams.get('page') || 1)
    const start = (currentPage - 1) * 50 + 1
    return route.fulfill({ json: ok({ items: Array.from({ length: 50 }, (_, index) => item(start + index)), total: 3450, page: currentPage, pageSize: 50 }) })
  })
  await page.route('**/api/playlist-sources/source-browser/initialization', route => route.fulfill({
    json: ok({ applicable: true, initialization, downloadConcurrency: 3, convergenceQueueDepth: 0 }),
  }))
  await page.route('**/api/playlist-sources/source-browser', route => route.fulfill({
    json: ok({ ...source, initializationStatus: 'awaiting_review', initializationTotalItems: 3450 }),
  }))
  await page.route('**/api/runs**', route => route.fulfill({ json: ok({ items: [], total: 0 }) }))
  const submittedRequests: Record<string, unknown>[] = []
  await page.route('**/api/playlist-sources/source-browser/initialization/decisions', async route => {
    submittedRequests.push(await route.request().postDataJSON() as Record<string, unknown>)
    return route.fulfill({ json: ok({ changed: 2 }) })
  })

  await page.goto('/sync-sources/source-browser?tab=initialization')
  await expect(page.getByText('浏览器验收歌单 · 3450 首（接管快照）')).toBeVisible()
  await expect(page.getByText('3450', { exact: true })).toBeVisible()
  await expect(page.locator('.source-adoption__metrics').getByText('已有绑定', { exact: true })).toBeVisible()
  await expect(page.locator('.source-adoption__metrics').getByText('可能候选', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '查看证据', exact: true }).first().click()
  await expect(page.getByRole('dialog', { name: '歌曲 1 证据详情' })).toContainText('/music/1.flac')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: '歌曲 1 证据详情' })).toBeHidden()
  await page.getByRole('checkbox', { name: '选择 歌曲 1', exact: true }).check()
  await page.getByRole('button', { name: '下一页' }).click()
  await page.getByRole('checkbox', { name: '选择 歌曲 51', exact: true }).check()
  await expect(page.getByText('已跨页选择 2 首')).toBeVisible()
  await page.getByRole('button', { name: '下载并托管' }).click()
  await expect.poll(() => submittedRequests).toEqual([{ songIds: [1, 51], decision: 'download', initializationId: 'init-browser' }])
})

test('first media adoption preserves a verified binding without asking for reselection', async ({ page }) => {
  await login(page)
  const initialization = initializationFixture({
    id: 'init-preserved', totalItems: 1, preservedItems: 1,
    strongItems: 0, highConfidenceItems: 0, possibleItems: 0, ambiguousItems: 0,
    unmatchedItems: 0, adoptItems: 0, downloadItems: 0, deferredItems: 0,
  })
  const preserved = preservedInitializationItem({ initializationId: 'init-preserved' })
  await page.route('**/api/playlist-sources/source-browser/initialization/items**', route => route.fulfill({
    json: ok({ items: [preserved], total: 1, page: 1, pageSize: 50 }),
  }))
  await page.route('**/api/playlist-sources/source-browser/initialization', route => route.fulfill({
    json: ok({ applicable: true, initialization, downloadConcurrency: 3, convergenceQueueDepth: 0 }),
  }))
  await page.route('**/api/playlist-sources/source-browser', route => route.fulfill({
    json: ok({ ...source, initializationStatus: 'awaiting_review', initializationTotalItems: 1 }),
  }))
  await page.route('**/api/runs**', route => route.fulfill({ json: ok({ items: [], total: 0 }) }))

  await page.goto('/sync-sources/source-browser?tab=initialization')
  await expect(page.getByRole('checkbox', { name: '选择 小半' })).toBeDisabled()
  await expect(page.getByText('保留现有绑定', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '查看证据' }).click()
  const dialog = page.getByRole('dialog', { name: '小半 证据详情' })
  await expect(dialog).toContainText('当前 Plex 绑定')
  await expect(dialog).toContainText('[netease-421423806]')
  await expect(dialog.getByRole('button', { name: '搜索其他 Plex 媒体' })).toHaveCount(0)
})

test('failed reanalysis keeps the current review draft visible', async ({ page }) => {
  await login(page)
  const initialization = initializationFixture({ id: 'init-reanalysis-failure' })
  const reviewItem = actionableInitializationItem(601, { initializationId: initialization.id })
  await mockInitializationReview(page, initialization, [reviewItem])
  let restartBody: Record<string, unknown> | null = null
  await page.route('**/api/playlist-sources/source-browser/initialization/restart', async route => {
    restartBody = await route.request().postDataJSON() as Record<string, unknown>
    await route.fulfill({ json: { code: 1, msg: '重新分析请求失败', data: null } })
  })

  await page.goto('/sync-sources/source-browser?tab=initialization')
  const reviewRow = page.locator('.source-adoption__table tbody tr').filter({ hasText: '歌曲 601' })
  await expect(reviewRow).toBeVisible()
  await page.getByRole('button', { name: '放弃方案并重新分析', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '重新分析首次媒体接管' })).toBeVisible()
  await page.getByRole('button', { name: '重新分析', exact: true }).click()

  await expect(page.getByRole('alert')).toContainText('重新分析请求失败')
  await expect(reviewRow).toBeVisible()
  await expect.poll(() => restartBody).toEqual({ initializationId: 'init-reanalysis-failure' })
})

test('commit conflict keeps the compatible review draft and reports the server error', async ({ page }) => {
  await login(page)
  const initialization = initializationFixture({ id: 'init-commit-conflict' })
  const reviewItem = actionableInitializationItem(602, { initializationId: initialization.id })
  await mockInitializationReview(page, initialization, [reviewItem])
  let commitBody: Record<string, unknown> | null = null
  await page.route('**/api/playlist-sources/source-browser/initialization/commit', async route => {
    commitBody = await route.request().postDataJSON() as Record<string, unknown>
    await route.fulfill({ json: { code: 1, msg: '接管方案已变化，请刷新后重试', data: null } })
  })

  await page.goto('/sync-sources/source-browser?tab=initialization')
  await page.getByRole('button', { name: '提交接管方案', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '提交首次媒体接管方案' })).toBeVisible()
  await page.getByRole('button', { name: '确认并应用', exact: true }).click()

  await expect(page.getByRole('alert')).toContainText('接管方案已变化，请刷新后重试')
  await expect(page.locator('.source-adoption__table tbody tr').filter({ hasText: '歌曲 602' })).toBeVisible()
  await expect(page.getByRole('button', { name: '提交接管方案', exact: true })).toBeVisible()
  await expect.poll(() => commitBody).toEqual({ initializationId: 'init-commit-conflict' })
})

test('old-version review drafts remain readable but cannot be edited or committed', async ({ page }) => {
  await login(page)
  const initialization = initializationFixture({ id: 'init-old-rules', ruleVersion: 0, rulesCompatible: false })
  const reviewItem = actionableInitializationItem(603, {
    initializationId: initialization.id,
    allowedDecisions: [],
    canSearch: false,
    unavailableReason: '方案不可编辑，请重新分析',
  })
  await mockInitializationReview(page, initialization, [reviewItem])

  await page.goto('/sync-sources/source-browser?tab=initialization')
  await expect(page.getByText('接管规则已更新', { exact: true })).toBeVisible()
  await expect(page.getByText('当前方案使用旧版匹配规则，仍可查看审核快照，但必须重新分析后才能编辑或提交。现有方案不会被应用。', { exact: true })).toBeVisible()
  await expect(page.locator('.source-adoption__table tbody tr').filter({ hasText: '歌曲 603' })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: '选择 歌曲 603', exact: true })).toBeDisabled()
  await expect(page.getByRole('combobox', { name: '歌曲 603 的处理决定', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '提交接管方案', exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: '查看证据', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '歌曲 603 证据详情' })
  await expect(dialog).toContainText('/music/603.flac')
  await expect(dialog.getByRole('button', { name: '搜索其他 Plex 媒体' })).toHaveCount(0)
})

test('dashboard renders mixed sync outcomes by count and source', async ({ page }) => {
  await login(page)
  await mockDashboardShell(page, {
    triggered: true,
    batchId: 'batch-mixed-browser',
    results: [
      {
        sourceId: 'source-convergence', status: 'accepted', kind: 'convergence',
        requestId: 'request-convergence', message: '已接受同步请求',
      },
      {
        sourceId: 'source-analysis', status: 'accepted', kind: 'analysis',
        requestId: null, initializationId: 'init-analysis', runId: 'run-analysis',
        message: '已接受首次媒体接管分析',
      },
      {
        sourceId: 'source-review', status: 'awaiting_review', initializationId: 'init-review',
        runId: 'run-review', message: '首次媒体接管等待确认',
      },
    ],
  })

  await page.goto('/')
  await page.getByRole('button', { name: '立即同步', exact: true }).click()

  const toast = page.locator('.toast-region')
  await expect(toast).toContainText('已接受 2 个来源请求，1 个来源等待确认')
  const result = page.getByRole('region', { name: '同步请求结果', exact: true })
  await expect(result).toBeVisible()
  await expect(result).toContainText('source-convergence')
  await expect(result).toContainText('已接受同步请求')
  await expect(result).toContainText('source-analysis')
  await expect(result).toContainText('已接受首次媒体接管分析')
  await expect(result).toContainText('source-review')
  await expect(result).toContainText('首次媒体接管等待确认')
})

test('busy sync response is reported as blocked instead of successful', async ({ page }) => {
  await login(page)
  await mockDashboardShell(page, {
    triggered: false,
    batchId: 'batch-busy-browser',
    results: [{
      sourceId: 'source-busy', status: 'busy',
      message: '已有来源任务或补全任务在运行中，请等待完成',
    }],
  })

  await page.goto('/')
  await page.getByRole('button', { name: '立即同步', exact: true }).click()

  const toast = page.locator('.toast-region')
  await expect(toast).toContainText('同步触发失败')
  await expect(toast).toContainText('已有来源任务或补全任务在运行中，请等待完成')
  await expect(toast).not.toContainText('已接受')
  await expect(toast).not.toContainText('同步已触发')
})

test('completed download waiting for source sync is visible in history and detail', async ({ page }) => {
  await login(page)
  const run = {
    id: 'run-download-awaiting-source-sync', type: 'manual_download', trigger: 'user',
    startedAt: '2026-09-07T00:00:00.000Z', finishedAt: '2026-09-07T00:00:12.000Z', status: 'success',
    durationMs: 12000, summary: '下载已完成', source: '待同步歌单', totalSongs: 1, successSongs: 1,
    failedSongs: 0, skippedSongs: 0, removedSongs: 0, warnings: 0, dryRun: false,
    awaitingSourceSync: true, sourceRequestStatus: 'pending',
  }
  const detail = {
    ...run, target: '待同步歌单', sourceIds: ['source-awaiting-sync'], detailsExpired: false,
    steps: [], songs: [], config: {},
  }
  await page.route('**/api/task-center/filter-options', route => route.fulfill({
    json: ok({ sources: [{ id: 'source-awaiting-sync', name: '待同步歌单', deleted: false }] }),
  }))
  await page.route('**/api/tasks/failures**', route => route.fulfill({ json: ok({ items: [], total: 0 }) }))
  await page.route('**/api/runs**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith(`/runs/${run.id}`)) {
      await route.fulfill({ json: ok(detail) })
      return
    }
    if (url.searchParams.get('status')) {
      await route.fulfill({ json: ok({ items: [], total: 0 }) })
      return
    }
    await route.fulfill({ json: ok({ items: [run], total: 1, earliestDate: run.startedAt }) })
  })

  await page.goto('/task-center?tab=runs')
  const runCard = page.getByRole('link', { name: '查看手动下载运行：下载完成，待同步', exact: true })
  await expect(runCard).toBeVisible()
  await expect(runCard).toContainText('下载完成，待同步')
  await expect(runCard).toContainText('等待执行')
  await runCard.click()

  await expect(page).toHaveURL(`/task-center/runs/${run.id}`)
  await expect(page.getByRole('heading', { name: '下载完成，待同步', exact: true })).toBeVisible()
  await expect(page.getByText('等待执行', { exact: true })).toBeVisible()
})

test('library preserves selection across layouts, persists view and filters, and batches selected IDs', async ({ page }) => {
  await login(page)
  await mockSourceMedia(page)
  let submitted: unknown = null
  await page.route('**/api/playlist-sources/batch', async route => {
    submitted = route.request().postDataJSON()
    await route.fulfill({ json: ok({ action: 'disable', count: 1 }) })
  })
  await page.goto('/sync-sources')
  await expect(page.locator('.library-collection--grid')).toBeVisible()
  await page.getByRole('checkbox', { name: '选择 浏览器验收歌单', exact: true }).check()
  await page.getByRole('button', { name: '列表视图', exact: true }).click()
  await expect(page.locator('.library-collection--list')).toBeVisible()
  await expect(page.getByRole('checkbox', { name: '选择 浏览器验收歌单', exact: true })).toBeChecked()
  await page.getByRole('button', { name: '禁用', exact: true }).click()
  await expect.poll(() => submitted).toEqual({ action: 'disable', ids: ['source-browser'] })
  await expect(page.getByRole('checkbox', { name: '选择 浏览器验收歌单', exact: true })).not.toBeChecked()
  await page.getByLabel('搜索同步源', { exact: true }).fill('浏览器')
  await expect(page).toHaveURL(/search=/)
  await expect(page.locator('.collection-item')).toHaveAttribute('draggable', 'false')
  await page.reload()
  await expect(page.locator('.library-collection--list')).toBeVisible()
  await expect(page.getByLabel('搜索同步源', { exact: true })).toHaveValue('浏览器')
})

test('command search opens a collection by keyboard and restores focus', async ({ page }) => {
  await login(page)
  await mockSourceMedia(page)
  const trigger = page.getByRole('button', { name: '搜索页面与音乐收藏', exact: true })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: '搜索与快捷跳转', exact: true })
  const field = dialog.getByLabel('搜索页面与收藏', { exact: true })
  await expect(field).toBeFocused()
  await field.fill('浏览器验收')
  await expect(dialog.getByRole('link', { name: /浏览器验收歌单/ })).toBeVisible()
  await field.press('Enter')
  await expect(page).toHaveURL('/sync-sources/source-browser')
  await expect(dialog).toBeHidden()
  await trigger.click()
  await field.press('Escape')
  await expect(trigger).toBeFocused()
})

test('library loading errors are visible and retry restores collections', async ({ page }) => {
  await login(page)
  await page.route('**/api/playlist-sources**', route => route.fulfill({ status: 503, json: { code: 503, msg: '测试：音乐库暂不可用', data: null } }))
  await page.goto('/sync-sources')
  await expect(page.getByRole('alert')).toContainText('无法读取音乐库')
  await expect(page.getByText('还没有收藏歌单', { exact: true })).toHaveCount(0)
  await page.unroute('**/api/playlist-sources**')
  await mockSourceMedia(page)
  await page.getByRole('button', { name: '重新加载', exact: true }).click()
  await expect(page.locator('.collection-item__title')).toContainText('浏览器验收歌单')
})

test('library sorting is local and manual drag order persists the displayed source IDs', async ({ page }) => {
  await login(page)
  let items = [{ ...source, id: 'z-source', name: 'Z collection' }, { ...source, id: 'a-source', name: 'A collection' }]
  let orderedIds: string[] = []
  await page.route('**/api/playlist-sources**', async route => {
    if (route.request().method() === 'PUT') {
      orderedIds = route.request().postDataJSON().orderedIds
      items = orderedIds.map(id => items.find(item => item.id === id)!)
      await route.fulfill({ json: ok({}) })
    } else await route.fulfill({ json: ok(items) })
  })
  await page.goto('/sync-sources')
  await page.getByRole('button', { name: '列表视图', exact: true }).click()
  await page.getByLabel('收藏排序', { exact: true }).selectOption('name')
  await expect(page.locator('.collection-item__title')).toHaveText(['A collection', 'Z collection'])
  await expect(page.locator('.collection-item').first()).toHaveAttribute('draggable', 'false')
  expect(orderedIds).toEqual([])
  await page.getByLabel('收藏排序', { exact: true }).selectOption('manual')
  await expect(page.locator('.collection-item__title')).toHaveText(['Z collection', 'A collection'])
  await page.locator('.collection-item').first().dragTo(page.locator('.collection-item').last())
  await expect.poll(() => orderedIds).toEqual(['a-source', 'z-source'])
})
