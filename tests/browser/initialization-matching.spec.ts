import { selectListOption } from './helpers/list-select'
import { expect, test, type Page } from './fixtures'

const PASSWORD = 'browser-test-password'
const ok = (data: unknown) => ({ code: 0, msg: 'ok', data })

const matching = {
  foldArtistDiacritics: false, corroboratedBilingualTitles: false,
  enabled: false, foldChinese: true, normalizeTypography: true, ignoreContextNotes: true,
  bilingualTitles: true, fuzzyTitles: false, useTrackArtist: true, useArtistAliases: true,
  supplementalTitleRecall: true, metadataFallback: true, corroboratedRecommendations: true, preferExactAlbum: true,
  duplicatePolicy: 'highest_quality', ignoreMissingCollaborators: false, musicBrainzAliases: false,
  musicBrainzMinScore: 100, musicBrainzMaxArtists: 40,
  artistPolicy: 'complete', usePathHints: true, albumPolicy: 'prefer', trackPolicy: 'prefer',
  recommendDurationMs: 2000, reviewDurationMs: 5000, recommendDurationPercent: 2,
  missingDuration: 'review', remasterPolicy: 'review', editionPolicy: 'review', explicitPolicy: 'strict',
  showVersionConflicts: true, unknownVersion: 'review', preferLossless: true, preferredDirectory: '/music',
  artistAliases: [{ name: '陈粒', aliases: ['Chen Li'], enabled: true }],
  titleAliases: [{ name: '小半', aliases: ['A Little Half'], enabled: true }],
}

const config = {
  netease: { cookie: '', quality: 'jymaster' },
  plex: { server: '', port: 32400, token: '', section: '音乐' },
  download: { dir: '/music', plexLibraryPathPrefix: '', downloadLyrics: true, embedMetadata: true, embedCover: true, saveAlbumCover: false, saveArtistImage: false },
  sync: { intervalMinutes: 30, songLimit: 10, downloadConcurrency: 3, plexScanRetries: 5, plexScanRetryDelaySec: 15, enabled: false, logRetentionDays: 30, jobRetentionSuccessDays: 7, jobRetentionFailedDays: 30, downloadTaskRetentionDays: 30, forceFullCompare: false, reconcileOnPlexDrift: true, fullCompareAfterSkips: 5, fullCompareAfterDays: 7, autoDownloadAlbum: false, skipPlexPlaylist: false, skipRemoveExtraTracks: false, extraTrackRemovalPolicy: 'balanced', maxFailureAttempts: 3, unverifiedMediaPolicy: 'download_managed', initializeMediaOnFirstSync: true },
  other: { multiArtistFormat: 'ampersand', lyricOrder: 'original_first', downloadTranslatedLyric: true, downloadRomajiLyric: false, artistAliases: { '旧艺人名': 'Legacy Artist' }, applyAliasToAlbum: false, pathFormat: '{artist}/{album}/{title}', fontScale: 1 },
  initializationMatching: matching,
}

const sources = [
  { id: 'matching-source', name: '匹配预览歌单', neteasePlaylistName: '匹配预览歌单', type: 'playlist', trackCount: 14 },
  { id: 'other-source', name: '另一份歌单', neteasePlaylistName: '另一份歌单', type: 'playlist', trackCount: 2 },
  { id: 'album-source', name: '不会出现在预览', neteasePlaylistName: '不会出现在预览', type: 'album', trackCount: 1 },
]

function previewResult() {
  const items = Array.from({ length: 14 }, (_, index) => ({
    songId: index + 1,
    title: `预览歌曲 ${index + 1}`,
    artists: ['陈粒'],
    before: 'unmatched',
    after: index === 0 ? 'high_confidence' : 'unmatched',
    change: index === 0 ? 'added' : 'unchanged',
    candidate: index === 0 ? { ratingKey: 'plex-1', title: '预览歌曲 1', artist: 'Chen Li', album: '专辑', filePath: '/music/1.flac', durationMs: 180000 } : null,
    candidates: [],
    reasons: index === 0 ? ['标题与时长一致', '艺人别名候选'] : [],
    conflicts: index === 0 ? ['当前草稿启用模糊标题'] : [],
  }))
  return {
    snapshotId: 'snapshot-one', capturedAt: '2026-09-17T00:00:00.000Z', expiresAt: '2099-09-17T00:20:00.000Z',
    sourceId: 'matching-source', sourceName: '匹配预览歌单', total: items.length, trackCount: 14,
    configFingerprint: 'server-fingerprint',
    before: { preserved: 1, strong: 2, recommended: 3, review: 4, duplicates: 1, versionConflicts: 1, identityConflicts: 0, unmatched: 2, metadataMissing: 0 },
    after: { preserved: 1, strong: 2, recommended: 4, review: 3, duplicates: 1, versionConflicts: 1, identityConflicts: 0, unmatched: 2, metadataMissing: 0 },
    items,
    aliasSuggestions: [{ name: '新艺人', aliases: ['New Artist'], enabled: true, count: 2, examples: ['预览歌曲 1'] }],
  }
}

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('管理员密码', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL('/')
}

async function prepare(page: Page, includeMatching = true) {
  await page.route('**/api/config', route => route.fulfill({ json: ok(includeMatching ? config : { ...config, initializationMatching: undefined }) }))
  await page.route('**/api/playlist-sources', route => route.fulfill({ json: ok(sources) }))
  await login(page)
}

test('批量推荐策略保存并显示 MusicBrainz 降级说明', async ({ page }, testInfo) => {
  await prepare(page)
  let saved = config
  await page.route('**/api/config', async route => {
    if (route.request().method() === 'PUT') saved = route.request().postDataJSON()
    await route.fulfill({ json: ok(saved) })
  })
  await page.route('**/api/initialization-matching/preview', route => route.fulfill({ json: ok({ ...previewResult(),
    musicBrainz: { groups: [], queried: 0, skipped: 12, warnings: ['MusicBrainz 不可用：未解析的艺人沿用普通规则。'] } }) }))
  await page.goto('/config?tab=matching&source=matching-source')
  await expect(page.getByLabel('多个候选时', { exact: true })).toHaveValue('highest_quality')
  await page.getByRole('switch', { name: '忽略缺失合作歌手', exact: true }).click()
  await page.getByRole('switch', { name: '折叠艺人拉丁重音', exact: true }).click()
  await page.getByRole('switch', { name: '双语标题交叉推荐', exact: true }).click()
  await page.getByRole('switch', { name: 'MusicBrainz 艺人异名辅助', exact: true }).click()
  await page.getByLabel('MusicBrainz 每轮艺人上限', { exact: true }).fill('60')
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  await expect.poll(() => saved.initializationMatching.ignoreMissingCollaborators).toBe(true)
  expect(saved.initializationMatching.musicBrainzAliases).toBe(true)
  expect(saved.initializationMatching.foldArtistDiacritics).toBe(true)
  expect(saved.initializationMatching.corroboratedBilingualTitles).toBe(true)
  expect(saved.initializationMatching.musicBrainzMaxArtists).toBe(60)
  await page.reload()
  await expect(page.getByRole('switch', { name: '忽略缺失合作歌手', exact: true })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('heading', { name: '批量推荐策略', exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('bulk-policies-desktop.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('heading', { name: '批量推荐策略', exact: true }).scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('bulk-policies-mobile.png') })
  await page.getByRole('button', { name: '生成预览', exact: true }).click()
  await expect(page.getByText('MusicBrainz 不可用：未解析的艺人沿用普通规则。', { exact: true })).toBeVisible()
})

test('初始化匹配从可选配置回退，并使用 source query 选择歌单', async ({ page }) => {
  await prepare(page, false)
  await page.goto('/config?tab=matching&source=matching-source')

  await expect(page.getByRole('tab', { name: '初始化匹配', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('switch', { name: '启用增强初始化匹配', exact: true })).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByLabel('预览来源', { exact: true })).toHaveAttribute('data-value', 'matching-source')
  await expect(page.getByRole('button', { name: '管理艺人名称', exact: true })).toBeVisible()
  await expect(page.getByLabel('首选目录', { exact: true })).toHaveValue('')
})

test('新召回开关显示说明，并随预设切换', async ({ page }) => {
  await prepare(page)
  await page.goto('/config?tab=matching')

  const titleRecall = page.getByRole('switch', { name: '扩展标题召回', exact: true })
  const metadataFallback = page.getByRole('switch', { name: '专辑曲序补充检索', exact: true })
  await expect(titleRecall).toHaveAttribute('aria-checked', 'true')
  await expect(metadataFallback).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByText('作品附注、双语标题、数字写法与古典作品编号等仅用于补充待审候选', { exact: true })).toBeVisible()
  await expect(page.getByText('标题未命中时，以艺人、同专辑、同曲序和接近时长找回待审候选，不直接推荐', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: /^保守/ }).click()
  await expect(titleRecall).toHaveAttribute('aria-checked', 'false')
  await expect(metadataFallback).toHaveAttribute('aria-checked', 'false')

  await page.getByRole('button', { name: /^发现/ }).click()
  await expect(titleRecall).toHaveAttribute('aria-checked', 'true')
  await expect(metadataFallback).toHaveAttribute('aria-checked', 'true')

  await titleRecall.click()
  await metadataFallback.click()
  await expect(titleRecall).toHaveAttribute('aria-checked', 'false')
  await expect(metadataFallback).toHaveAttribute('aria-checked', 'false')
})

test('交叉证据推荐开关通过统一保存条持久化', async ({ page }) => {
  await prepare(page)
  const captured: { saved?: typeof config } = {}
  await page.route('**/api/config', async route => {
    if (route.request().method() === 'PUT') {
      captured.saved = route.request().postDataJSON()
    }
    await route.fulfill({ json: ok(captured.saved ?? config) })
  })
  await page.goto('/config?tab=matching')

  const corroborated = page.getByRole('switch', { name: '交叉证据推荐', exact: true })
  await expect(corroborated).toHaveAttribute('aria-checked', 'true')
  await corroborated.click()
  await expect(corroborated).toHaveAttribute('aria-checked', 'false')
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  await expect.poll(() => captured.saved?.initializationMatching.corroboratedRecommendations).toBe(false)
  expect(captured.saved?.other.artistAliases).toEqual(config.other.artistAliases)

  await page.reload()
  await expect(page.getByRole('switch', { name: '交叉证据推荐', exact: true })).toHaveAttribute('aria-checked', 'false')
})

test('匹配预览复用快照、支持显式刷新、筛选分页和手动确认别名建议', async ({ page }) => {
  await prepare(page)
  const requests: Array<Record<string, unknown>> = []
  await page.route('**/api/initialization-matching/preview', async route => {
    requests.push(route.request().postDataJSON())
    await route.fulfill({ json: ok(previewResult()) })
  })
  await page.goto('/config?tab=matching&source=matching-source')
  await expect(page.getByLabel('预览来源', { exact: true })).toHaveAttribute('data-value', 'matching-source')

  await page.getByRole('button', { name: /^保守/ }).click()
  await expect(page.getByLabel('首选目录', { exact: true })).toHaveValue('/music')
  await expect(page.locator('input[aria-label="第 1 组艺人名称"]')).toHaveValue('陈粒')
  await page.getByRole('button', { name: '生成预览', exact: true }).click()
  await expect(page.getByText('快照基线', { exact: true })).toBeVisible()
  await expect(page.getByText('当前参数草稿', { exact: true })).toBeVisible()
  await expect(page.getByText('预览歌曲 1', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '加入艺人别名', exact: true })).toBeVisible()
  expect(requests[0]).toEqual(expect.objectContaining({ sourceId: 'matching-source', config: expect.objectContaining({ enabled: true }) }))
  expect(requests[0]).not.toHaveProperty('snapshotId')

  await page.getByRole('button', { name: '加入艺人别名', exact: true }).click()
  await expect(page.locator('input[aria-label="第 2 组艺人名称"]')).toHaveValue('新艺人')
  await page.getByRole('switch', { name: '启用模糊标题', exact: true }).click()
  await expect(page.getByText('设置已修改，下面的结果仍来自上一次运行。', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: '按当前设置重新预览', exact: true }).click()
  await expect.poll(() => requests.length).toBe(2)
  expect(requests[1]).toHaveProperty('snapshotId', 'snapshot-one')

  await page.getByRole('button', { name: '刷新快照', exact: true }).click()
  await expect.poll(() => requests.length).toBe(3)
  expect(requests[2]).not.toHaveProperty('snapshotId')
  await selectListOption(page, page.getByLabel('预览结果筛选', { exact: true }), 'all')
  await page.getByLabel('搜索预览结果', { exact: true }).fill('预览歌曲 14')
  await expect(page.getByText('预览歌曲 14', { exact: true })).toBeVisible()
  await expect(page.getByText('查看理由、冲突与候选', { exact: true })).toHaveCount(1)

  await selectListOption(page, page.getByLabel('预览来源', { exact: true }), 'other-source')
  await expect(page.getByText('快照基线', { exact: true })).toHaveCount(0)
})

test('独立别名编辑保持焦点、保留逗号并通过统一保存条保存', async ({ page }) => {
  await prepare(page)
  const captured: { saved?: typeof config } = {}
  await page.route('**/api/config', async route => {
    if (route.request().method() === 'PUT') captured.saved = route.request().postDataJSON()
    await route.fulfill({ json: ok(captured.saved ?? config) })
  })
  await page.goto('/config?tab=artists')
  const table = page.getByRole('region', { name: '艺人名称规则' })
  const name = table.getByRole('textbox', { name: '第 1 组艺人名称', exact: true })
  await name.fill('')
  await name.pressSequentially('New Artist')
  await expect(name).toBeFocused()
  await expect(name).toHaveValue('New Artist')
  await table.getByLabel('第 1 组艺人别名', { exact: true }).fill('Earth, Wind & Fire\nAnother Artist')
  await name.click()
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  await expect.poll(() => captured.saved?.initializationMatching.artistAliases[0]?.aliases).toEqual(['Earth, Wind & Fire', 'Another Artist'])
  expect(captured.saved?.other.artistAliases).toEqual(config.other.artistAliases)
  await page.reload()
  await expect(name).toHaveValue('New Artist')
})

test('试算错误可刷新恢复，手机布局无横向溢出', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await prepare(page)
  let attempts = 0
  await page.route('**/api/initialization-matching/preview', route => {
    attempts++
    return route.fulfill({ json: attempts === 1 ? { code: 1, msg: '试算快照已过期，请重新读取数据', data: null } : ok(previewResult()) })
  })
  await page.goto('/config?tab=matching&source=matching-source')
  await expect(page.getByRole('switch', { name: '启用增强初始化匹配', exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('matching-mobile-settings.png') })
  await page.getByRole('button', { name: '生成预览', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('试算快照已过期')
  await page.getByRole('button', { name: '刷新快照', exact: true }).click()
  await expect(page.getByText('快照基线', { exact: true })).toBeVisible()
  await page.getByText('快照基线', { exact: true }).scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('matching-mobile-preview.png') })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByText('快照基线', { exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('matching-desktop-preview.png') })
})


test('目标专辑唯一优选可关闭并随预设切换', async ({ page }) => {
  await prepare(page)
  const captured: { saved?: typeof config } = {}
  await page.route('**/api/config', async route => {
    if (route.request().method() === 'PUT') captured.saved = route.request().postDataJSON()
    await route.fulfill({ json: ok(captured.saved ?? config) })
  })
  await page.goto('/config?tab=matching')
  const preference = page.getByRole('switch', { name: '目标专辑唯一优选', exact: true })
  await expect(preference).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('button', { name: /^保守/ }).click()
  await expect(preference).toHaveAttribute('aria-checked', 'false')
  await page.getByRole('button', { name: /^平衡/ }).click()
  await expect(preference).toHaveAttribute('aria-checked', 'true')
  await preference.click()
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  await expect.poll(() => captured.saved?.initializationMatching.preferExactAlbum).toBe(false)
})

test('统一艺人规则保留未完成草稿、显式写入和批量编辑', async ({ page }, testInfo) => {
  await prepare(page)
  const captured: { saved?: typeof config } = {}
  await page.route('**/api/config', async route => {
    if (route.request().method() === 'PUT') captured.saved = route.request().postDataJSON()
    await route.fulfill({ json: ok(captured.saved ?? config) })
  })
  await page.goto('/config?tab=artists')
  const region = page.getByRole('region', { name: '艺人名称规则' })
  const save = page.getByRole('button', { name: '保存配置', exact: true })
  await region.getByRole('button', { name: '添加艺人', exact: true }).click()
  await expect(save).toBeDisabled()
  await page.getByRole('tab', { name: '下载与文件', exact: true }).click()
  await page.getByRole('button', { name: '返回修正', exact: true }).click()
  const name = region.getByRole('textbox', { name: '第 2 组艺人名称', exact: true })
  await expect(name).toHaveValue('')
  await name.fill('新艺人')
  await region.getByLabel('第 2 组艺人别名', { exact: true }).fill('Alias')
  await name.click()
  await save.click()
  await expect.poll(() => captured.saved?.initializationMatching.artistAliases.length).toBe(2)
  expect(captured.saved?.other.artistAliases).toEqual(config.other.artistAliases)
  await expect(save).toBeEnabled()
  await expect(region.getByRole('textbox', { name: '第 2 组艺人名称', exact: true })).toHaveValue('新艺人')
  await region.getByRole('tab', { name: '写入替换', exact: true }).click()
  await region.getByRole('button', { name: '添加替换', exact: true }).click()
  const group = region.locator('.artist-write').last()
  await group.getByPlaceholder('原名称', { exact: true }).fill('Alias')
  await expect(save).toBeDisabled()
  await group.getByPlaceholder('写入名称', { exact: true }).fill('新艺人')
  await save.click()
  await expect.poll(() => (captured.saved?.other.artistAliases as Record<string, string> | undefined)?.['Alias']).toBe('新艺人')
  await region.getByRole('button', { name: '批量编辑写入映射（JSON）' }).click()
  await region.getByLabel('写入映射 JSON').fill('{broken')
  await region.getByRole('button', { name: '应用到草稿' }).click()
  await expect(save).toBeDisabled()
  await region.getByRole('button', { name: '取消批量编辑' }).click()
  await expect(save).toBeEnabled()
  await region.getByRole('tab', { name: '匹配别名', exact: true }).click()
  await region.getByRole('button', { name: '添加艺人', exact: true }).click()
  await page.getByRole('button', { name: '放弃修改', exact: true }).click()
  await expect(save).toBeEnabled()
  await expect(region.locator('fieldset')).toHaveCount(2)
  await expect(page.getByRole('button', { name: '关闭提示', exact: true })).toHaveCount(0, { timeout: 10000 })
  await expect(region.locator('details')).toHaveCount(0)
  await expect(region.getByRole('textbox', { name: '第 1 组艺人名称', exact: true })).toBeVisible()
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.evaluate(() => window.scrollTo(0, 0))
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`artist-names-${width}.png`), fullPage: true, animations: 'disabled' })
  }
  await page.evaluate(() => localStorage.setItem('yunplex2-theme', 'light'))
  await page.reload()
  await expect(region).toBeVisible()
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.screenshot({ path: testInfo.outputPath('artist-names-light.png'), fullPage: true, animations: 'disabled' })
})
