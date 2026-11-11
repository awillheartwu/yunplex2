import type { Page } from '@playwright/test'
import type { TaskRun } from '../../server/lib/job/types'
import type { FailureRecord } from '../../server/lib/tasks/failure-model'
import type { FailureGroup } from '../../server/lib/tasks/failure-groups'
import { expect, test } from './fixtures'
import { login } from './helpers/config'

const firstSeenAt = '2026-10-18T08:00:00.000Z'
const lastSeenAt = '2026-10-18T09:00:00.000Z'

function success<T>(data: T, msg = 'ok') {
  return { code: 0, msg, data }
}

function runFixture(): TaskRun {
  return {
    id: 'run-with-failures',
    type: 'sync',
    trigger: 'user',
    startedAt: firstSeenAt,
    finishedAt: lastSeenAt,
    status: 'partial',
    durationMs: 60_000,
    summary: '1 首歌曲需要处理',
    source: 'Test playlist',
    sourceIds: ['source-1'],
    target: 'Test playlist',
    totalSongs: 2,
    successSongs: 0,
    failedSongs: 1,
    skippedSongs: 1,
    removedSongs: 0,
    warnings: 0,
    dryRun: false,
    steps: [],
    songs: [{
      id: 'song-run-1',
      sourceId: 'source-1',
      neteaseSongId: 1,
      neteaseIndex: 0,
      songName: 'Failed Song',
      artist: 'Test Artist',
      album: 'Test Album',
      status: 'failed_download',
      phase: 'download',
      error: { title: '下载失败', message: '连接超时', stage: 'download', code: 'failed_download' },
    }],
    config: {},
  }
}

const failureGroup: FailureGroup = {
  id: 'failure-ignored',
  key: 'failed_download:连接超时',
  failureKind: 'failed_download',
  failureReason: '连接超时',
  label: '下载失败',
  total: 2,
  songCount: 2,
  sourceCount: 1,
  occurrenceCount: 2,
  retryableCount: 1,
  ignorableCount: 0,
  retryUnavailableReason: '缺少可重新处理的来源、歌曲或文件任务，请查看关联运行',
  firstSeenAt,
  lastSeenAt,
}

function failureRecord(id: string, songName: string, status: 'ignored' | 'resolved' | 'open'): FailureRecord {
  return {
    id,
    fingerprint: `fingerprint-${id}`,
    subjectKey: `subject-${id}`,
    songId: id === 'failure-ignored' ? 1 : 2,
    songName,
    artist: 'Test Artist',
    sourceId: 'source-1',
    sourceName: 'Test playlist',
    runId: 'run-with-failures',
    runType: 'sync',
    failureKind: 'failed_download',
    failureReason: '连接超时',
    errorCode: 'failed_download',
    errorCategory: 'netease',
    errorSeverity: 'error',
    retryable: status !== 'resolved',
    userMessage: '歌曲下载失败，请重试或查看关联运行获取详情。',
    status,
    firstSeenAt,
    lastSeenAt,
    ignoredAt: status === 'ignored' ? lastSeenAt : null,
    resolvedAt: status === 'resolved' ? lastSeenAt : null,
    occurrenceCount: 1,
    attemptCount: status === 'open' ? 1 : 3,
    attemptLimit: 3,
    ignoreReason: status === 'ignored' ? 'manual' : null,
    retryCount: 0,
    downloadTaskIds: ['task-1'],
  }
}

async function routeRunDetail(page: Page) {
  await page.route('**/api/runs/run-with-failures', route => route.fulfill({ json: success(runFixture()) }))
  await page.route('**/api/playlist-sources', route => route.fulfill({ json: success([{
    id: 'source-1', name: 'Test playlist', type: 'playlist', trackCount: 2, enabled: true, subscribed: false,
  }]) }))
  await page.route('**/api/task-center/filter-options', route => route.fulfill({ json: success({
    sources: [{ id: 'source-1', name: 'Test playlist', deleted: false }],
  }) }))
}

test('run detail opens all failure states and an ignored item can be retried directly', async ({ page }) => {
  await login(page)
  await routeRunDetail(page)
  const groupRequests: URLSearchParams[] = []
  const listRequests: URLSearchParams[] = []
  let retryBody: unknown

  await page.route('**/api/tasks/failure-groups?**', route => {
    groupRequests.push(new URL(route.request().url()).searchParams)
    return route.fulfill({ json: success({ items: [failureGroup], total: 1, recordTotal: 2 }) })
  })
  await page.route('**/api/tasks/failures?**', route => {
    const params = new URL(route.request().url()).searchParams
    if (params.get('limit') === '1') return route.fulfill({ json: success({ items: [], total: 1, retryableTotal: 1, ignorableTotal: 1, ignoredTotal: 0 }) })
    listRequests.push(params)
    return route.fulfill({ json: success({
      items: [
        failureRecord('failure-ignored', 'Ignored Song', 'ignored'),
        failureRecord('failure-resolved', 'Resolved Song', 'resolved'),
      ],
      total: 2,
      retryableTotal: 1,
      ignorableTotal: 0,
      ignoredTotal: 1,
    }) })
  })
  await page.route('**/api/tasks/failures/batch-retry', async route => {
    retryBody = route.request().postDataJSON()
    await route.fulfill({ json: success({ count: 1 }, '已提交 1 项重新处理') })
  })

  await page.goto('/task-center/runs/run-with-failures')
  await page.getByRole('link', { name: '查看异常处理', exact: true }).click()

  await expect(page).toHaveURL(url => url.pathname === '/task-center'
    && url.searchParams.get('tab') === 'failures'
    && url.searchParams.get('failureStatus') === 'all'
    && url.searchParams.get('failureRun') === 'run-with-failures')
  await expect(page.getByRole('group', { name: '异常状态筛选' })
    .getByRole('button', { name: '全部', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => groupRequests.some(params => params.get('status') === 'all'
    && params.get('runId') === 'run-with-failures')).toBe(true)

  await page.getByRole('button', { name: /查看明细/, exact: true }).click()
  const ignoredRow = page.getByRole('article').filter({ hasText: 'Ignored Song' })
  const resolvedRow = page.getByRole('article').filter({ hasText: 'Resolved Song' })
  await expect(ignoredRow.getByText('当前：已忽略', { exact: true })).toBeVisible()
  await expect(resolvedRow.getByText('当前：已解决', { exact: true })).toBeVisible()
  expect(listRequests.at(-1)?.get('status')).toBe('all')
  expect(listRequests.at(-1)?.get('runId')).toBe('run-with-failures')

  const requestsBeforeRetry = listRequests.length
  await ignoredRow.getByRole('button', { name: '重试', exact: true }).click()

  await expect(page.getByText('已提交 1 项重新处理', { exact: true })).toBeVisible()
  expect(retryBody).toEqual({ ids: ['failure-ignored'] })
  await expect.poll(() => listRequests.length).toBeGreaterThan(requestsBeforeRetry)
  expect(listRequests.at(-1)?.get('status')).toBe('all')
  expect(listRequests.at(-1)?.get('runId')).toBe('run-with-failures')
})

test('pending failures can select all pages, exclude one item, and batch-ignore exactly that range', async ({ page }) => {
  await login(page)
  const listRequests: URLSearchParams[] = []
  let ignoreBody: unknown

  await page.route('**/api/task-center/filter-options', route => route.fulfill({ json: success({ sources: [] }) }))
  await page.route('**/api/tasks/failures?**', route => {
    const params = new URL(route.request().url()).searchParams
    if (params.get('limit') === '1') return route.fulfill({ json: success({ items: [], total: 58, retryableTotal: 2, ignorableTotal: 58, ignoredTotal: 0 }) })
    listRequests.push(params)
    return route.fulfill({ json: success({
      items: [
        failureRecord('failure-open-1', 'Open One', 'open'),
        failureRecord('failure-open-2', 'Open Two', 'open'),
      ],
      total: 60,
      retryableTotal: 2,
      ignorableTotal: 60,
      ignoredTotal: 0,
    }) })
  })
  await page.route('**/api/tasks/failures/batch-ignore', async route => {
    ignoreBody = route.request().postDataJSON()
    await route.fulfill({ json: success({ count: 59 }, '59 个问题已忽略') })
  })

  await page.goto('/task-center?tab=failures&failureView=songs')
  await expect(page.getByText('Open One', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '全选全部 60 项', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '已选 60 / 60 项' })).toBeVisible()

  await page.getByRole('checkbox', { name: '选择 Open Two', exact: true }).uncheck()
  await expect(page.getByRole('status').filter({ hasText: '已选 59 / 60 项' })).toBeVisible()
  const requestsBeforeIgnore = listRequests.length
  await page.getByRole('button', { name: '批量忽略', exact: true }).click()

  await expect(page.getByText('59 个问题已忽略', { exact: true })).toBeVisible()
  expect(ignoreBody).toMatchObject({
    allMatching: true,
    excludeIds: ['failure-open-2'],
    filter: { status: 'open', offset: '0', limit: '50' },
  })
  await expect.poll(() => listRequests.length).toBeGreaterThan(requestsBeforeIgnore)
  expect(listRequests.at(-1)?.get('status')).toBe('open')
  expect(listRequests.at(-1)?.get('offset')).toBe('0')
})
