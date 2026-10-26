import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '~~/server/lib/db'
import { getSource } from '~~/server/lib/playlist/store'
import { clearSyncWorker, setSyncService } from '~~/server/lib/sync/instance'
import { getFailureRecords } from '~~/server/lib/tasks/failure-queries'
import { getSourceFailureStatus } from '~~/server/lib/sync/failure-policy'
import { recordFailure } from '~~/server/lib/tasks/failure-records'
import { retryFailureRecords } from '~~/server/lib/tasks/retry'
import {
  createFailureTestDatabase,
  insertCurrentTrackOccurrence,
  insertFailureSource,
  type FailureTestDatabase,
} from '../../../../helpers/failure-fixtures'

let testDb: FailureTestDatabase

function failRounds(
  input: Omit<Parameters<typeof recordFailure>[0], 'runId'>,
  rounds = 3,
  prefix = 'failure',
) {
  return Array.from({ length: rounds }, (_, index) => recordFailure({
    ...input,
    runId: `${prefix}-${index + 1}`,
    occurredAt: `2026-06-20T12:3${index}:00.000Z`,
  }))
}

beforeEach(() => {
  testDb = createFailureTestDatabase('reyunplex-retry-')
  clearSyncWorker()
  setSyncService({
    getState: () => ({ isRunning: false }),
  } as never)
})

afterEach(() => {
  clearSyncWorker()
  testDb.cleanup()
})

describe('manual failure retry', () => {
  it('reopens only the selected song and its source prerequisite with a fresh attempt budget', () => {
    insertFailureSource('source-1')
    insertCurrentTrackOccurrence('source-1', 101)
    insertCurrentTrackOccurrence('source-1', 202, 1)
    const selectedRounds = failRounds({
      songId: 101,
      songName: 'Selected Failure',
      sourceId: 'source-1',
      runType: 'sync',
      failureKind: 'failed_download',
    }, 3, 'selected')
    const otherRounds = failRounds({
      songId: 202,
      songName: 'Other Failure',
      sourceId: 'source-1',
      runType: 'sync',
      failureKind: 'failed_download',
    }, 3, 'other')
    const sourceRounds = failRounds({
      songName: '来源同步',
      sourceId: 'source-1',
      runType: 'sync',
      failureKind: 'scheduler_interrupted',
    }, 3, 'source')
    const selected = selectedRounds.at(-1)!
    const other = otherRounds.at(-1)!
    const sourceFailure = sourceRounds.at(-1)!

    const result = retryFailureRecords([selected.id])

    expect(result).toMatchObject({ count: 1, sourceCount: 1, downloadTaskCount: 0 })
    expect(getFailureRecords([selected.id])[0]).toMatchObject({
      status: 'open',
      attemptCount: 0,
      attemptLimit: 3,
      occurrenceCount: 3,
      retryCount: 1,
      ignoreReason: null,
    })
    expect(getFailureRecords([sourceFailure.id])[0]).toMatchObject({
      status: 'open',
      attemptCount: 0,
      occurrenceCount: 3,
      retryCount: 1,
      ignoreReason: null,
    })
    expect(getFailureRecords([other.id])[0]).toMatchObject({
      status: 'ignored',
      attemptCount: 3,
      occurrenceCount: 3,
      retryCount: 0,
      ignoreReason: 'automatic',
    })
    expect(getSourceFailureStatus('source-1')).toBe('open')
    expect(getDb().prepare(`
      SELECT status, trigger, request_kind, mode, retry_song_ids_json
      FROM source_sync_queue
    `).get()).toEqual({
      status: 'pending',
      trigger: 'retry',
      request_kind: 'convergence',
      mode: 'full',
      retry_song_ids_json: '[101]',
    })
    expect(getSource('source-1')?.lastScheduleStatus).toBe('queued')

    const laterRounds = failRounds({
      songId: 101,
      songName: 'Selected Failure',
      sourceId: 'source-1',
      runType: 'sync',
      failureKind: 'failed_download',
    }, 3, 'after-retry')

    expect(laterRounds.map(record => [record.status, record.attemptCount])).toEqual([
      ['open', 1],
      ['open', 2],
      ['ignored', 3],
    ])
    expect(getFailureRecords([selected.id])[0]).toMatchObject({
      status: 'ignored',
      occurrenceCount: 6,
      retryCount: 1,
      ignoreReason: 'automatic',
    })
  })
})
