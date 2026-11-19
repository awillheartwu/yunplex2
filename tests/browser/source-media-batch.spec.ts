import { expect, test } from './fixtures'
import { login } from './helpers/config'
import { selectListOption } from './helpers/list-select'

const ok = (data: unknown) => ({ code: 0, msg: 'ok', data })

test('batch media selection assigns each file once and downloads the remaining song', async ({ page }) => {
  await login(page)
  const sourceId = 'source-batch-media'
  let remaining = [101, 102, 103]
  const source = { id: sourceId, name: '批量处理测试', neteasePlaylistName: '批量处理测试', neteasePlaylistId: 1001,
    type: 'playlist', enabled: true, trackCount: remaining.length, initializationStatus: 'completed' }
  const candidate = (ratingKey: string, filename: string) => ({
    ratingKey, title: '候选 ' + ratingKey, plexFilePath: '/music/' + filename + '.flac', artist: '测试艺人', album: '测试专辑',
    durationMs: 180000, owners: [],
  })
  const first = candidate('201', 'first')
  const alternative = candidate('202', 'alternative')
  const occupied = { ...candidate('203', 'occupied'), shareIssue: '已关联录音的版本不同',
    owners: [{ songId: 199, updatedAt: '2026-01-01T00:00:00Z', title: '已占用的录音', artists: ['测试艺人'], album: '测试专辑', durationMs: 180000 }] }
  await page.route(`**/api/playlist-sources/${sourceId}`, route => route.fulfill({ json: ok(source) }))
  await page.route('**/api/match-management/overview?**', route => route.fulfill({ json: ok({
    items: remaining.map(id => ({ state: 'awaiting_manual', binding: null, localMedia: null, occurrence: null,
      target: { neteaseSongId: id, title: '歌曲 ' + id, artists: ['测试艺人'], albumName: '测试专辑', coverUrl: '' }, affectedSources: [] })),
    total: remaining.length, page: 1, pageSize: 25,
  }) }))
  await page.route('**/api/match-management/plex-search?**', route => {
    const songId = new URL(route.request().url()).searchParams.get('availableForSongId')
    const data = songId === '103' ? { tracks: [], occupied: [occupied] }
      : { tracks: songId === '101' ? [first] : [candidate('204', 'first'), alternative], occupied: [] }
    return route.fulfill({ json: ok(data) })
  })
  await page.route('**/api/match-management/bindings/batch-rebind', route => {
    remaining = [103]
    return route.fulfill({ json: ok([{ songId: 101, error: null }, { songId: 102, error: null }]) })
  })
  await page.route(`**/api/playlist-sources/${sourceId}/songs/download-managed`, route =>
    route.fulfill({ json: ok({ batchId: 'batch-test', total: 1, selectionFailures: [] }) }))

  await page.goto(`/sync-sources/${sourceId}?tab=media`)
  await selectListOption(page, page.getByRole('combobox', { name: '媒体状态' }), 'needs_action')
  await page.getByLabel('全选本页').check()
  await page.getByRole('button', { name: '批量预选媒体' }).click()
  const dialog = page.getByRole('dialog', { name: '确认批量关联' })
  await expect(dialog.getByText('已关联录音的版本不同')).toBeVisible()
  const association = page.waitForRequest(request => request.url().endsWith('/match-management/bindings/batch-rebind'))
  await dialog.getByRole('button', { name: '保存 2 首关联' }).click()
  expect((await association).postDataJSON()).toEqual({ sourceId, choices: [
    { songId: 101, ratingKey: '201', plexFilePath: first.plexFilePath, expectedBindingUpdatedAt: null },
    { songId: 102, ratingKey: '202', plexFilePath: alternative.plexFilePath, expectedBindingUpdatedAt: null },
  ] })
  await expect(page.getByText('已选 1 首', { exact: true })).toBeVisible()

  await selectListOption(page, page.getByRole('combobox', { name: '批量操作' }), 'download')
  const download = page.waitForRequest(request => request.url().endsWith(`/playlist-sources/${sourceId}/songs/download-managed`))
  await page.getByRole('button', { name: '下载所选' }).click()
  expect((await download).postDataJSON()).toEqual({ songIds: [103] })
  await expect(page.getByText(/1 首已提交到下载队列/)).toBeVisible()
})
