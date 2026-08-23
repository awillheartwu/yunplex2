import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'
import {
  createHistoricalMigrations,
  type HistoricalMigrationRepairs,
} from './migration-history'

function repairs(): HistoricalMigrationRepairs {
  return {
    ensureAuthTables: vi.fn(),
    ensureDownloadTaskProcessingColumns: vi.fn(),
    ensureDownloadWhenMediaMissingOverride: vi.fn(),
    ensureLocalMediaAssetOwnership: vi.fn(),
    ensureMatchManagementSchema: vi.fn(),
    ensureMusicBrainzIdMappingCache: vi.fn(),
    ensureMusicBrainzRecordingCacheStatuses: vi.fn(),
    ensureNullableSourceSyncOverrides: vi.fn(),
    ensurePlaylistExtraObservationTable: vi.fn(),
    ensurePlaylistSourceSyncCursorColumns: vi.fn(),
    ensureSongIdentityBindingMethods: vi.fn(),
    ensureSongIdentityReviewSchema: vi.fn(),
    ensureTaskRunSources: vi.fn(),
    migrateLegacyJobsToTaskRunsAndDrop: vi.fn(),
    repairArtistResolutionCache: vi.fn(),
    retireActivityEvents: vi.fn(),
    retireSyncState: vi.fn(),
    retireWeakMetadataBindingsAndLookupCache: vi.fn(),
  }
}

describe('historical migration registry', () => {
  it('keeps the append-only migration count and late migration order stable', () => {
    const injected = repairs()
    const migrations = createHistoricalMigrations(injected)

    expect(migrations).toHaveLength(48)
    expect(migrations.slice(35)).toEqual([
      injected.ensureSongIdentityReviewSchema,
      injected.ensurePlaylistSourceSyncCursorColumns,
      injected.ensureMusicBrainzRecordingCacheStatuses,
      injected.ensurePlaylistExtraObservationTable,
      injected.ensureMusicBrainzIdMappingCache,
      injected.ensureSongIdentityBindingMethods,
      injected.ensureMatchManagementSchema,
      injected.ensureLocalMediaAssetOwnership,
      injected.ensureNullableSourceSyncOverrides,
      injected.retireWeakMetadataBindingsAndLookupCache,
      injected.ensureDownloadWhenMediaMissingOverride,
      injected.retireActivityEvents,
      injected.retireSyncState,
    ])
  })

  it('executes v25 against a legacy download table and links batches to task runs', () => {
    const database = new Database(':memory:')
    database.exec(`
      CREATE TABLE download_tasks (
        id TEXT PRIMARY KEY,
        source_id TEXT,
        status TEXT NOT NULL,
        job_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO download_tasks VALUES (
        'task-1', NULL, 'done', 'legacy-run-1',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:01:00.000Z'
      );
    `)

    try {
      createHistoricalMigrations(repairs())[23]!(database)

      const columns = database.prepare("PRAGMA table_info('download_tasks')").all() as Array<{ name: string }>
      expect(columns.map(column => column.name)).toContain('run_id')
      expect(database.prepare('SELECT run_id FROM download_tasks').get()).toEqual({ run_id: 'legacy-run-1' })
      expect(database.prepare('SELECT id, type, status FROM task_runs').get()).toEqual({
        id: 'legacy-run-1',
        type: 'manual_download',
        status: 'success',
      })
    } finally {
      database.close()
    }
  })
})
