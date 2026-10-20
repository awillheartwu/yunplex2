import { login } from './helpers/config'
import { expect, test } from './fixtures'

const ok = (data: unknown) => ({ code: 0, msg: 'ok', data })

test('explicit first-candidate choices work for rejected candidates, categories and deferred submission', async ({ page }) => {
  await login(page)
  const source = {
    id: 'source-first', name: '首个候选验收', neteasePlaylistName: '首个候选验收',
    neteasePlaylistId: 1001, type: 'playlist', enabled: true, trackCount: 2,
    initializationStatus: 'awaiting_review', initializationTotalItems: 2,
  }
  const initialization = {
    id: 'init-first', sourceId: source.id, status: 'awaiting_review', rulesCompatible: true, ruleVersion: 1,
    totalItems: 2, preservedItems: 0, strongItems: 0, highConfidenceItems: 0, possibleItems: 0,
    ambiguousItems: 0, unmatchedItems: 0, conflictItems: 2, adoptItems: 0, downloadItems: 0,
    deferredItems: 2, revision: 1, autoProcess: false, quickStatus: null,
  }
  const items = [1, 2].map(id => {
    const candidate = { ratingKey: 'plex-first', title: '小半', artist: 'Chen Li', album: '专辑', filePath: '/music/小半.flac', durationMs: 180000 }
    return {
      initializationId: initialization.id, neteaseSongId: id, position: id - 1, occurrenceCount: 1,
      title: `小半 ${id}`, artists: ['陈粒'], album: '专辑', trackNumber: 1, durationMs: 180000,
      tier: 'conflict', candidate: null, candidates: [candidate], expectedBindingUpdatedAt: null,
      evidence: { scoredCandidates: [{ candidate, score: { total: 65, eligible: false, risks: ['艺人名称不同'] } }] },
      decisionStatus: 'proposed', kind: 'actionable', decision: 'defer',
      allowedDecisions: ['download', 'defer'], canSearch: true, unavailableReason: null,
    }
  })
  const arrangements: Array<Record<string, unknown>> = []
  const commits: Array<Record<string, unknown>> = []
  await page.route('**/api/playlist-sources/source-first', route => route.fulfill({ json: ok(source) }))
  await page.route('**/api/playlist-sources/source-first/initialization', route => route.fulfill({
    json: ok({ applicable: true, initialization, downloadConcurrency: 1, convergenceQueueDepth: 0 }),
  }))
  await page.route('**/api/playlist-sources/source-first/initialization/items**', route => route.fulfill({
    json: ok({ items, total: 2, selectableTotal: 2, adoptableTotal: 0, page: 1, pageSize: 50 }),
  }))
  await page.route('**/api/playlist-sources/source-first/initialization/arrange', async route => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    arrangements.push(body)
    if (body.scope === 'deferred') initialization.deferredItems = 0
    initialization.revision++
    await route.fulfill({ json: ok({ changed: 2, matched: 2, downloads: 0, started: false }) })
  })
  await page.route('**/api/playlist-sources/source-first/initialization/commit', async route => {
    commits.push(route.request().postDataJSON() as Record<string, unknown>)
    await route.fulfill({ json: ok({ initializationId: initialization.id, applied: 2, downloads: 0 }) })
  })
  await page.route('**/api/runs**', route => route.fulfill({ json: ok({ items: [], total: 0 }) }))

  await page.goto('/sync-sources/source-first?tab=initialization')
  await page.getByRole('checkbox', { name: '选择 小半 1', exact: true }).check()
  const firstCandidate = page.getByRole('button', { name: '采用第一个候选', exact: true })
  await expect(firstCandidate).toBeEnabled()
  await firstCandidate.click()
  await expect.poll(() => arrangements[0]).toEqual({ initializationId: 'init-first', scope: 'selected', songIds: [1] })

  await page.getByRole('navigation', { name: '候选分组' }).getByRole('button', { name: /存在冲突/ }).click()
  await page.getByRole('button', { name: '跨页全选「冲突」', exact: true }).click()
  await firstCandidate.click()
  await expect.poll(() => arrangements[1]).toEqual({
    initializationId: 'init-first', scope: 'selected', filter: { tier: 'conflict', search: '', excludeSongIds: [] },
  })
  await page.getByRole('button', { name: '此分类采用第一个候选', exact: true }).click()
  await expect.poll(() => arrangements[2]).toEqual({ initializationId: 'init-first', scope: 'conflict' })

  await page.getByRole('button', { name: '开始下载并同步', exact: true }).first().click()
  const confirm = page.getByRole('dialog', { name: '还有 2 首不会加入 Plex', exact: true })
  await expect(confirm).toContainText('没有候选的安排下载')
  await confirm.getByRole('button', { name: '采用首个候选并开始', exact: true }).click()
  await expect.poll(() => arrangements[3]).toEqual({ initializationId: 'init-first', scope: 'deferred' })
  await expect.poll(() => commits).toEqual([{ initializationId: 'init-first', confirmDeferred: false }])
})
