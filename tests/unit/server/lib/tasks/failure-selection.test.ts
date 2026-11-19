import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '~~/server/lib/db'
import { recordFailure, setFailureRecordStatus } from '~~/server/lib/tasks/failure-records'
import { resolveFailureMutationIds } from '~~/server/lib/tasks/failure-groups'
import { createFailureTestDatabase, insertFailureSource, type FailureTestDatabase } from '../../../../helpers/failure-fixtures'

let testDb: FailureTestDatabase
beforeEach(() => {
  testDb = createFailureTestDatabase('reyunplex-failure-selection-')
  insertFailureSource('source-1')
  insertFailureSource('source-2')
})
afterEach(() => { testDb.cleanup() })

describe('failure batch selection', () => {
  it('applies the full filter beyond one page while preserving exclusions and other current states', () => {
    const records = Array.from({ length: 60 }, (_, index) => recordFailure({
      songId: index + 1, songName: `Selected ${index + 1}`, sourceId: 'source-1', runId: 'run-1',
      runType: 'sync', failureKind: 'failed_download', failureReason: 'connection failed',
    }))
    const other = recordFailure({
      songId: 1, songName: 'Other source', sourceId: 'source-2', runId: 'run-1',
      runType: 'sync', failureKind: 'failed_download',
    })
    const excluded = records[59]!
    const resolved = records[0]!
    // A result can change after the user selected all matching records.
    setFailureRecordStatus([resolved.id], 'resolved')
    const ids = resolveFailureMutationIds({
      allMatching: true, excludeIds: [excluded.id], filter: { status: 'all', sourceId: 'source-1' },
    }, ['open'])

    expect(ids).toHaveLength(58)
    expect(setFailureRecordStatus(ids, 'ignored')).toBe(58)
    const remaining = getDb().prepare(`SELECT id, status FROM failure_records WHERE status != 'ignored' ORDER BY id`).all()
    expect(remaining).toEqual(expect.arrayContaining([
      { id: excluded.id, status: 'open' }, { id: resolved.id, status: 'resolved' }, { id: other.id, status: 'open' },
    ]))
    expect(remaining).toHaveLength(3)
    expect(resolveFailureMutationIds({ allMatching: true, filter: { status: 'resolved' } }, ['open'])).toEqual([])
  })
})
