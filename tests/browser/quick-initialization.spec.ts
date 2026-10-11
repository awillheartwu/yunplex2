import { expect, test, type Page } from './fixtures'

const PASSWORD = 'browser-test-password'
const ok = (data: unknown) => ({ code: 0, msg: 'ok', data })

async function login(page: Page): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('管理员密码', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible()
}

const source = {
  id: 'quick-source', name: '快速方案歌单', neteasePlaylistName: '快速方案歌单', neteasePlaylistId: 2026, type: 'playlist',
  enabled: true, subscribed: false, coverUrl: '', trackCount: 60, plexPlaylistName: '快速方案', plexPlaylistRatingKey: 'plex-quick',
  lastStatus: 'idle', lastSyncedAt: null, initializationStatus: 'awaiting_review', initializationTotalItems: 60,
}

function initialization(overrides: Record<string, unknown> = {}) {
  return {
    id: 'quick-init', sourceId: source.id, runId: null, followUpRunId: null, trigger: 'user', status: 'awaiting_review',
    revision: 7, scoreVersion: 1, quickThreshold: 85, quickStatus: null, ruleVersion: 1, rulesCompatible: true,
    matchingConfig: { config: { enabled: true } }, requestId: null, requestStatus: null, neteaseCursor: null, plexFingerprint: null,
    totalItems: 60, preservedItems: 10, strongItems: 0, highConfidenceItems: 40, possibleItems: 0, ambiguousItems: 0,
    unmatchedItems: 10, adoptItems: 0, downloadItems: 0, deferredItems: 0, conflictItems: 0, summary: '', error: null,
    createdAt: '2026-10-08T00:00:00.000Z', startedAt: null, analyzedAt: '2026-10-08T00:00:00.000Z', completedAt: null,
    updatedAt: '2026-10-08T00:00:00.000Z', ...overrides,
  }
}

const scoreParts = { title: 35, artists: 35, duration: 18.5, album: 7, track: 0 }

function reviewItem(overrides: Record<string, unknown> = {}) {
  return {
    initializationId: 'quick-init', neteaseSongId: 1, position: 0, occurrenceCount: 1, title: '审核样本歌曲', artists: ['测试艺人'], album: '测试专辑',
    trackNumber: 1, durationMs: 180000, tier: 'high_confidence',
    candidate: { ratingKey: 'plex-1', title: '审核样本歌曲', artist: '测试艺人', album: '测试专辑', durationMs: 180000, trackNumber: 1, filePath: '/music/1.flac' },
    candidates: [], decisionStatus: 'proposed', expectedBindingUpdatedAt: null, kind: 'actionable', decision: 'defer',
    allowedDecisions: ['adopt', 'download', 'defer'], canSearch: true, unavailableReason: null,
    evidence: {
      rule: 'enhanced_metadata',
      scoredCandidates: [{
        candidate: { ratingKey: 'plex-1', title: '审核样本歌曲', artist: '测试艺人', album: '测试专辑', durationMs: 180000, trackNumber: 1, filePath: '/music/1.flac' },
        score: { version: 1, total: 95.5, eligible: true, parts: scoreParts, coverage: 0.98, blocked: [], risks: ['时长接近上限'], durationDeltaMs: 120, completeArtists: true, titleStrength: 1 },
      }],
    },
    ...overrides,
  }
}

function planItem(id: number, overrides: Record<string, unknown> = {}) {
  return {
    songId: id, title: `快速样本歌曲 ${id}`, decision: 'adopt', origin: 'threshold_match',
    candidate: { ratingKey: `plex-${id}`, title: `快速样本歌曲 ${id}`, artist: '测试艺人', album: '测试专辑', durationMs: 180000, trackNumber: 1, filePath: `/music/${id}.flac` },
    score: 90 + (id % 10) / 10, risks: [], sharedIds: [], ...overrides,
  }
}

function quickPreview(page: number, threshold = 85) {
  const start = (page - 1) * 50
  const count = page === 1 ? 50 : 10
  return {
    operationId: 'op-1', token: 'token-1', initializationId: 'quick-init', revision: 7, threshold, expiresAt: '2026-10-08T01:00:00.000Z',
    counts: { preserved: 10, matched: 40, downloads: 10, shared: 2, overwritten: 50 }, histogram: [0, 0, 0, 0, 0, 0, 1, 3, 12, 34],
    items: Array.from({ length: count }, (_, index) => planItem(start + index + 1, index === 0 && page === 1 ? { risks: ['标题包含版本附注'], sharedIds: [1, 7] } : {})),
    total: 60, page, pageSize: 50,
  }
}

function routeSource(page: Page, options: { initialization?: () => Record<string, unknown>; items?: unknown[] } = {}): void {
  void page.route('**/api/playlist-sources/quick-source', route => route.fulfill({ json: ok(source) }))
  void page.route('**/api/playlist-sources/quick-source/initialization', route => route.fulfill({ json: ok({ applicable: true, initialization: options.initialization ? options.initialization() : initialization(), downloadConcurrency: 3, convergenceQueueDepth: 0 }) }))
  void page.route('**/api/playlist-sources/quick-source/initialization/items**', route => route.fulfill({ json: ok({ items: options.items ?? [], total: options.items?.length ?? 0, page: 1, pageSize: 50 }) }))
  void page.route('**/api/runs**', route => route.fulfill({ json: ok({ items: [], total: 0 }) }))
}

for (const width of [375, 1440]) {
  test(`quick plan previews, pages and queues processing at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await login(page)
    const state = { revision: 7, queued: false }
    routeSource(page, { initialization: () => initialization({ revision: state.revision, quickStatus: state.queued ? 'queued' : null }), items: [reviewItem()] })
    const previewBodies: unknown[] = []
    await page.route('**/api/playlist-sources/quick-source/initialization/quick-preview**', route => {
      if (route.request().method() === 'POST') {
        previewBodies.push(route.request().postDataJSON())
        return route.fulfill({ json: ok(quickPreview(1, (route.request().postDataJSON() as { threshold: number }).threshold)) })
      }
      const search = new URL(route.request().url()).searchParams
      return route.fulfill({ json: ok(quickPreview(Number(search.get('page') || 1))) })
    })
    const confirmBodies: unknown[] = []
    await page.route('**/api/playlist-sources/quick-source/initialization/quick-confirm', route => {
      confirmBodies.push(route.request().postDataJSON())
      state.queued = true
      return route.fulfill({ json: ok({ operationId: 'op-1', requestId: 'req-1', status: 'queued' }) })
    })

    await page.goto('/sync-sources/quick-source?tab=initialization')
    const quick = page.getByRole('dialog', { name: '快速方案', exact: true })

    const scoreChip = page.locator('.source-adoption__table .source-adoption__score')
    await expect(scoreChip).toHaveText('评分 95.5')
    await page.locator('.source-adoption__table tbody tr').first().screenshot({ path: `/tmp/quick-score-row-${width}.png` })
    await page.getByRole('button', { name: '查看证据', exact: true }).click()
    const drawer = page.getByRole('dialog', { name: '审核样本歌曲 证据详情' })
    await expect(drawer.getByRole('heading', { name: '候选评分' })).toBeVisible()
    await drawer.getByText('查看 1 个候选的评分明细').click()
    await expect(drawer.getByText('95.5 分')).toBeVisible()
    await expect(drawer.getByText('风险：时长接近上限')).toBeVisible()
    await drawer.screenshot({ path: `/tmp/quick-score-drawer-${width}.png` })
    expect(await drawer.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: '快速方案', exact: true }).click()
    await expect(quick.getByLabel('分数线（0–100 整数）')).toHaveValue('85')
    await quick.getByRole('button', { name: '生成快速预览' }).click()
    await expect(quick.locator('.source-adoption__quick-items li')).toHaveCount(50)
    await page.keyboard.press('Escape')
    await expect(quick).toBeHidden()
    await expect(page.getByRole('button', { name: '快速方案', exact: true })).toBeFocused()
    await page.getByRole('button', { name: '快速方案', exact: true }).click()
    expect(previewBodies[0]).toEqual({ initializationId: 'quick-init', revision: 7, threshold: 85 })
    await expect(quick.getByText('预览分数线 85 · 共 60 首 · 第 1 / 2 页')).toBeVisible()
    await expect(quick.locator('.source-adoption__quick-counts')).toContainText('采用 Plex40')
    await expect(quick.locator('.source-adoption__quick-items li')).toHaveCount(50)
    await expect(quick.getByText('共享组 #1、#7')).toBeVisible()

    await quick.getByRole('button', { name: '下一页' }).click()
    await expect(quick.getByText('预览分数线 85 · 共 60 首 · 第 2 / 2 页')).toBeVisible()
    await expect(quick.locator('.source-adoption__quick-items li')).toHaveCount(10)
    await expect(quick.getByText('快速样本歌曲 60')).toBeVisible()

    await quick.getByLabel('分数线（0–100 整数）').fill('90')
    await expect(quick.locator('.source-adoption__quick-items')).toHaveCount(0)
    await expect(quick.getByText('分数线已修改，旧预览已失效')).toBeVisible()
    await quick.getByRole('button', { name: '生成快速预览' }).click()
    expect(previewBodies[1]).toEqual({ initializationId: 'quick-init', revision: 7, threshold: 90 })

    await quick.getByRole('button', { name: '确认并启动处理' }).click()
    expect(confirmBodies[0]).toEqual({ operationId: 'op-1', token: 'token-1', start: true })
    await expect(quick.getByText('快速方案已提交并排队')).toBeVisible()
    await expect(quick.getByText('正在等待后台处理')).toBeVisible()
    await expect(quick.getByRole('button', { name: '确认并启动处理' })).toBeDisabled()
    await expect(page.getByRole('button', { name: '提交接管方案' })).toBeDisabled()
    await expect(page.locator('.source-adoption__table select').first()).toBeDisabled()
    await quick.screenshot({ path: `/tmp/quick-initialization-${width}.png` })
    expect(await quick.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  })
}

test('quick plan keeps its preview on failure and restores a saved draft', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await login(page)
  const state = { revision: 7 }
  routeSource(page, { initialization: () => initialization({ revision: state.revision }), items: [reviewItem()] })
  await page.route('**/api/playlist-sources/quick-source/initialization/quick-preview**', route => route.fulfill({ json: ok(quickPreview(1)) }))
  let saveAttempts = 0
  const restoreBodies: unknown[] = []
  await page.route('**/api/playlist-sources/quick-source/initialization/quick-confirm', route => {
    saveAttempts += 1
    if (saveAttempts === 1) return route.fulfill({ json: { code: 1, msg: '草案已变化，请重新预览', data: null } })
    state.revision = 8
    return route.fulfill({ json: ok({ operationId: 'op-1', requestId: null, status: 'saved' }) })
  })
  await page.route('**/api/playlist-sources/quick-source/initialization/quick-restore', route => {
    restoreBodies.push(route.request().postDataJSON())
    state.revision = 9
    return route.fulfill({ json: ok({ restored: true }) })
  })

  await page.goto('/sync-sources/quick-source?tab=initialization')
  const quick = page.getByRole('dialog', { name: '快速方案', exact: true })
  await page.getByRole('button', { name: '快速方案', exact: true }).click()
  await quick.getByRole('button', { name: '生成快速预览' }).click()
  await expect(quick.locator('.source-adoption__quick-items li')).toHaveCount(50)

  await quick.getByRole('button', { name: '仅保存草案' }).click()
  await expect(quick.getByRole('alert')).toContainText('草案已变化')
  await expect(quick.locator('.source-adoption__quick-items li')).toHaveCount(50)

  await quick.getByRole('button', { name: '仅保存草案' }).click()
  await expect(quick.getByText('草案已保存，尚未启动处理')).toBeVisible()
  await expect(quick.locator('.source-adoption__quick-items')).toHaveCount(0)
  await quick.getByRole('button', { name: '恢复此前草案' }).click()
  await expect(quick.getByText('已恢复此前草案。')).toBeVisible()
  expect(restoreBodies).toEqual([{ operationId: 'op-1', token: 'token-1' }])
  await expect(quick.getByRole('button', { name: '恢复此前草案' })).toHaveCount(0)
})

test('quick plan refuses drafts without score version 1', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await login(page)
  routeSource(page, { initialization: () => initialization({ scoreVersion: 2 }), items: [reviewItem()] })

  await page.goto('/sync-sources/quick-source?tab=initialization')
  const quick = page.getByRole('dialog', { name: '快速方案', exact: true })
  await page.getByRole('button', { name: '快速方案', exact: true }).click()
  await expect(quick).toContainText('需要重新分析')
  await expect(quick.getByRole('button', { name: '生成快速预览' })).toBeDisabled()
  await expect(quick.getByLabel('分数线（0–100 整数）')).toBeDisabled()
})
