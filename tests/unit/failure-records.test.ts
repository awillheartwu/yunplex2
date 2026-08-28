import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDb, initDb } from '../../server/lib/db'
import {
  failureFingerprint,
  getSourceFailureCounts,
  getSourceFailurePolicy,
  queryFailureRecords,
  recordFailure,
  resolveFailures,
  setFailureRecordStatus,
  shouldPauseSourceFailure,
} from '../../server/lib/tasks/failure-records'
import { saveRun } from '../../server/lib/run/store'
import type { TaskRun } from '../../server/lib/job/types'

const directories: string[] = []
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'reyunplex-failures-'))
  directories.push(directory)
  initDb(directory)
}

describe('failure records', () => {
  afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  })

  it('projects a shared structured error policy without migrating the table', () => {
    setup()
    const record = recordFailure({
      songId: 42,
      songName: 'Song',
      runType: 'sync',
      failureKind: 'failed_download',
      failureReason: 'HTTP 429 too many requests',
    })

    expect(record).toMatchObject({
      failureKind: 'rate_limited',
      errorCode: 'rate_limited',
      errorCategory: 'netease',
      errorSeverity: 'warning',
      retryable: true,
    })
  })

  it('redacts credentials in new and historical failure reasons', () => {
    setup()
    const record = recordFailure({
      songName: 'Secret',
      runType: 'manual_download',
      failureKind: 'failed_download',
      failureReason: 'request failed token=secret',
    })
    expect(record.failureReason).toBe('request failed token=[REDACTED]')

    getDb().prepare('UPDATE failure_records SET failure_reason = ? WHERE id = ?')
      .run('Cookie: old-secret', record.id)
    expect(queryFailureRecords({ status: 'open' }).items[0]?.failureReason).toBe('Cookie: [REDACTED]')
  })

  it('uses the song identity, source, and failure stage as its fingerprint', () => {
    expect(failureFingerprint({
      songId: 42,
      songName: 'Song',
      artist: 'Artist',
      sourceId: 'source',
      failureKind: 'failed_download',
    })).not.toBe(failureFingerprint({
      songId: 42,
      songName: 'Song',
      artist: 'Artist',
      sourceId: 'source',
      failureKind: 'failed_tags',
    }))
  })

  it('resolves successful work and reopens the same record on recurrence', () => {
    setup()
    const record = recordFailure({
      songId: 42,
      songName: 'Song',
      artist: 'Artist',
      sourceId: 'source',
      runId: 'run-1',
      runType: 'sync',
      failureKind: 'failed_download',
      failureReason: 'network',
    })
    expect(queryFailureRecords({ status: 'open' }).total).toBe(1)
    expect(resolveFailures({ songId: 42, songName: 'Song', artist: 'Artist', sourceId: 'source' })).toBe(1)
    expect(queryFailureRecords({ status: 'resolved' }).total).toBe(1)

    recordFailure({
      songId: 42,
      songName: 'Song',
      artist: 'Artist',
      sourceId: 'source',
      runId: 'run-2',
      runType: 'sync',
      failureKind: 'failed_download',
      failureReason: 'network',
    })
    const reopened = queryFailureRecords({ status: 'open' }).items[0]
    expect(reopened?.id).toBe(record.id)
    expect(reopened?.occurrenceCount).toBe(2)
  })

  it('keeps ignored failures ignored until explicitly reopened', () => {
    setup()
    const record = recordFailure({
      songName: 'Song',
      runType: 'manual_download',
      failureKind: 'failed_download',
    })
    setFailureRecordStatus([record.id], 'ignored')
    recordFailure({
      songName: 'Song',
      runType: 'manual_download',
      failureKind: 'failed_download',
      runId: 'later',
    })
    expect(queryFailureRecords({ status: 'ignored' }).total).toBe(1)
  })

  it('keeps first and last seen bounds correct when history is replayed out of order', () => {
    setup()
    recordFailure({
      songId: 42,
      songName: 'Song',
      artist: 'Artist',
      sourceId: 'source',
      runId: 'newer-run',
      runType: 'sync',
      failureKind: 'failed_download',
      occurredAt: '2026-06-20T12:31:00.000Z',
    })
    recordFailure({
      songId: 42,
      songName: 'Song',
      artist: 'Artist',
      sourceId: 'source',
      runId: 'older-run',
      runType: 'sync',
      failureKind: 'failed_download',
      occurredAt: '2026-06-20T12:30:00.000Z',
    })

    const record = queryFailureRecords({ status: 'open' }).items[0]
    expect(record?.firstSeenAt).toBe('2026-06-20T12:30:00.000Z')
    expect(record?.lastSeenAt).toBe('2026-06-20T12:31:00.000Z')
  })

  it('does not count the same run twice during idempotent history replay', () => {
    setup()
    const failure = {
      songId: 42,
      songName: 'Song',
      artist: 'Artist',
      sourceId: 'source',
      runId: 'run-1',
      runType: 'sync' as const,
      failureKind: 'failed_download',
      failureReason: 'network',
      occurredAt: '2026-06-20T12:30:00.000Z',
    }
    recordFailure(failure)
    recordFailure(failure)

    expect(queryFailureRecords({ status: 'open' }).items[0]?.occurrenceCount).toBe(1)
  })

  it('does not let an older success resolve a newer failure', () => {
    setup()
    recordFailure({
      songId: 42,
      songName: 'Song',
      artist: 'Artist',
      sourceId: 'source',
      runId: 'run-2',
      runType: 'sync',
      failureKind: 'failed_download',
      occurredAt: '2026-06-20T12:31:00.000Z',
    })

    expect(resolveFailures({
      songId: 42,
      songName: 'Song',
      artist: 'Artist',
      sourceId: 'source',
      resolvedAt: '2026-06-20T12:30:00.000Z',
    })).toBe(0)
    expect(queryFailureRecords({ status: 'open' }).total).toBe(1)
  })

  it('includes the full selected local day in date filters', () => {
    setup()
    recordFailure({
      songName: 'Before',
      runType: 'sync',
      failureKind: 'failed_download',
      occurredAt: '2026-06-21T15:59:59.999Z',
    })
    recordFailure({
      songName: 'Start',
      runType: 'sync',
      failureKind: 'failed_download',
      occurredAt: '2026-06-21T16:00:00.000Z',
    })
    recordFailure({
      songName: 'End',
      runType: 'sync',
      failureKind: 'failed_download',
      occurredAt: '2026-06-22T15:59:59.999Z',
    })
    recordFailure({
      songName: 'After',
      runType: 'sync',
      failureKind: 'failed_download',
      occurredAt: '2026-06-22T16:00:00.000Z',
    })

    expect(queryFailureRecords({
      status: 'open',
      from: '2026-06-22',
      to: '2026-06-22',
      timeZone: 'Asia/Shanghai',
    }).items.map(item => item.songName)).toEqual(['End', 'Start'])
  })

  it('searches the current source display name when legacy records stored the source id', () => {
    setup()
    const now = '2026-06-22T00:00:00.000Z'
    getDb().prepare(`
      INSERT INTO playlist_sources (
        id, netease_playlist_id, name, netease_playlist_name, created_at, updated_at
      ) VALUES ('source-1', 1, '华语摇滚任务', '华语摇滚', ?, ?)
    `).run(now, now)
    recordFailure({
      songName: 'Song',
      sourceId: 'source-1',
      sourceName: 'source-1',
      runType: 'sync',
      failureKind: 'failed_download',
    })

    const result = queryFailureRecords({ status: 'open', search: '华语摇滚' })
    expect(result.total).toBe(1)
    expect(result.items[0]?.sourceName).toBe('华语摇滚任务')
  })

  it('derives the authoritative run type instead of trusting a download caller guess', () => {
    setup()
    const run: TaskRun = {
      id: 'repair-run',
      type: 'repair',
      trigger: 'user',
      startedAt: '2026-06-22T00:00:00.000Z',
      finishedAt: null,
      status: 'running',
      durationMs: 0,
      summary: '补全',
      source: '网易云音乐',
      target: '本地磁盘',
      totalSongs: 1,
      successSongs: 0,
      failedSongs: 0,
      skippedSongs: 0,
      removedSongs: 0,
      warnings: 0,
      dryRun: false,
      steps: [],
      songs: [],
      config: {},
    }
    saveRun(run)

    recordFailure({
      songName: 'Song',
      runId: run.id,
      runType: 'sync',
      failureKind: 'failed_download',
    })

    expect(queryFailureRecords({ status: 'open', type: 'repair' }).total).toBe(1)
    expect(queryFailureRecords({ status: 'open', type: 'sync' }).total).toBe(0)
  })

  it('derives source retry policy and source counts from the failure read model', () => {
    setup()
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      recordFailure({
        songId: 42,
        songName: 'Download Failure',
        sourceId: 'source-one',
        runId: `run-${attempt}`,
        runType: 'sync',
        failureKind: 'failed_download',
      })
    }
    recordFailure({
      songId: 43,
      songName: 'Restricted',
      sourceId: 'source-one',
      runType: 'sync',
      failureKind: 'copyright_restricted',
    })
    recordFailure({
      songId: 44,
      songName: 'Plex Match',
      sourceId: 'source-one',
      runType: 'sync',
      failureKind: 'failed_plex_match',
    })

    const policy = getSourceFailurePolicy('source-one')
    expect(policy.copyrightSongIds).toEqual([43])
    expect(policy.failuresBySongId[42]).toMatchObject({ occurrenceCount: 3, phase: 'download' })
    expect(shouldPauseSourceFailure(policy.failuresBySongId[42], 3)).toBe(true)
    expect(shouldPauseSourceFailure(policy.failuresBySongId[44], 1)).toBe(false)
    expect(getSourceFailureCounts('source-one')).toEqual({ actionable: 2, copyrightRestricted: 1 })
  })
})
