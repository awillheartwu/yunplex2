import type Database from 'better-sqlite3'
import { tableExists } from './introspection'

export interface HistoricalMigrationRepairs {
  ensureAuthTables: (d: Database.Database) => void
  ensureDownloadTaskProcessingColumns: (d: Database.Database) => void
  ensureDownloadWhenMediaMissingOverride: (d: Database.Database) => void
  ensureLocalMediaAssetOwnership: (d: Database.Database) => void
  ensureMatchManagementSchema: (d: Database.Database) => void
  ensureMusicBrainzIdMappingCache: (d: Database.Database) => void
  ensureMusicBrainzRecordingCacheStatuses: (d: Database.Database) => void
  ensureNullableSourceSyncOverrides: (d: Database.Database) => void
  ensurePlaylistExtraObservationTable: (d: Database.Database) => void
  ensurePlaylistSourceSyncCursorColumns: (d: Database.Database) => void
  ensureSongIdentityBindingMethods: (d: Database.Database) => void
  ensureSongIdentityReviewSchema: (d: Database.Database) => void
  ensureTaskRunSources: (d: Database.Database) => void
  migrateLegacyJobsToTaskRunsAndDrop: (d: Database.Database) => void
  repairArtistResolutionCache: (d: Database.Database) => void
  retireActivityEvents: (d: Database.Database) => void
  retireSyncState: (d: Database.Database) => void
  retireWeakMetadataBindingsAndLookupCache: (d: Database.Database) => void
}

/**
 * Immutable, append-only migration history. Current-schema repair functions are
 * injected so this module preserves historical execution order without sharing
 * a mutable schema snapshot.
 */
export function createHistoricalMigrations(repairs: HistoricalMigrationRepairs): Array<(d: Database.Database) => void> {
  const {
    ensureAuthTables,
    ensureDownloadTaskProcessingColumns,
    ensureDownloadWhenMediaMissingOverride,
    ensureLocalMediaAssetOwnership,
    ensureMatchManagementSchema,
    ensureMusicBrainzIdMappingCache,
    ensureMusicBrainzRecordingCacheStatuses,
    ensureNullableSourceSyncOverrides,
    ensurePlaylistExtraObservationTable,
    ensurePlaylistSourceSyncCursorColumns,
    ensureSongIdentityBindingMethods,
    ensureSongIdentityReviewSchema,
    ensureTaskRunSources,
    migrateLegacyJobsToTaskRunsAndDrop,
    repairArtistResolutionCache,
    retireActivityEvents,
    retireSyncState,
    retireWeakMetadataBindingsAndLookupCache,
  } = repairs

  return [
  /* v1: initial schema — covered by createSchema */
  /* v2: add last_job_id to playlist_sources */
  (d) => { d.prepare('ALTER TABLE playlist_sources ADD COLUMN last_job_id TEXT').run() },
  /* v3: add auto_create_plex_playlist to playlist_sources */
  (d) => { d.prepare('ALTER TABLE playlist_sources ADD COLUMN auto_create_plex_playlist INTEGER NOT NULL DEFAULT 0').run() },
  /* v4: song_lookup table for Plex track caching */
  (d) => {
    d.prepare(`
      CREATE TABLE IF NOT EXISTS song_lookup (
        netease_song_id   INTEGER PRIMARY KEY,
        plex_rating_key   TEXT,
        file_path         TEXT,
        last_verified_at  TEXT NOT NULL
      )
    `).run()
    d.prepare('CREATE INDEX IF NOT EXISTS idx_song_lookup_rating_key ON song_lookup(plex_rating_key)').run()
  },
  /* v5: add last_track_update_time to playlist_sources */
  (d) => { d.prepare('ALTER TABLE playlist_sources ADD COLUMN last_track_update_time INTEGER').run() },
  /* v6: add force_full_compare to playlist_sources */
  (d) => { d.prepare('ALTER TABLE playlist_sources ADD COLUMN force_full_compare INTEGER NOT NULL DEFAULT 0').run() },
  /* v7: add skip tracking + plex timestamp to playlist_sources */
  (d) => {
    d.prepare('ALTER TABLE playlist_sources ADD COLUMN consecutive_skips INTEGER NOT NULL DEFAULT 0').run()
    d.prepare('ALTER TABLE playlist_sources ADD COLUMN last_full_compare_at TEXT').run()
    d.prepare('ALTER TABLE playlist_sources ADD COLUMN plex_updated_at INTEGER').run()
  },
  /* v8: add track ID snapshot for incremental diff */
  (d) => { d.prepare('ALTER TABLE playlist_sources ADD COLUMN track_id_snapshot TEXT').run() },
  /* v9: add netease playlist name for display */
  (d) => {
    d.prepare('ALTER TABLE playlist_sources ADD COLUMN netease_playlist_name TEXT NOT NULL DEFAULT \'\'').run()
    d.prepare("UPDATE playlist_sources SET netease_playlist_name = name WHERE netease_playlist_name = ''").run()
  },
  /* v10: add sort_order for drag-and-drop ordering */
  (d) => {
    d.prepare('ALTER TABLE playlist_sources ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0').run()
    // Backfill: assign sort_order based on created_at (oldest first)
    const rows = d.prepare('SELECT id FROM playlist_sources ORDER BY created_at ASC').all() as { id: string }[]
    const stmt = d.prepare('UPDATE playlist_sources SET sort_order = ? WHERE id = ?')
    rows.forEach((r, i) => stmt.run(i, r.id))
  },
  /* v11: add removed_songs to jobs */
  (d) => {
    d.prepare('ALTER TABLE jobs ADD COLUMN removed_songs INTEGER NOT NULL DEFAULT 0').run()
  },
  /* v12: per-source skip/full-compare overrides */
  (d) => {
    d.prepare('ALTER TABLE playlist_sources ADD COLUMN full_compare_after_skips INTEGER').run()
    d.prepare('ALTER TABLE playlist_sources ADD COLUMN full_compare_after_days INTEGER').run()
  },
  /* v13: drop redundant downloads table, add time index on download_tasks */
  (d) => {
    d.prepare('DROP TABLE IF EXISTS downloads').run()
    d.prepare('CREATE INDEX IF NOT EXISTS idx_download_tasks_time ON download_tasks(updated_at DESC)').run()
  },
  /* v14: add type (playlist/album) and subscribed to playlist_sources */
  (d) => {
    d.prepare("ALTER TABLE playlist_sources ADD COLUMN type TEXT NOT NULL DEFAULT 'playlist'").run()
    d.prepare('ALTER TABLE playlist_sources ADD COLUMN subscribed INTEGER NOT NULL DEFAULT 0').run()
  },
  /* v15: add skip_plex_playlist for album sources */
  (d) => {
    d.prepare('ALTER TABLE playlist_sources ADD COLUMN skip_plex_playlist INTEGER NOT NULL DEFAULT 0').run()
  },
  /* v16: add copyright_restricted_ids for caching undownloadable songs */
  (d) => {
    d.prepare('ALTER TABLE playlist_sources ADD COLUMN copyright_restricted_ids TEXT').run()
  },
  /* v17: add ignored_failure_ids for failure tracking across syncs */
  (d) => {
    d.prepare('ALTER TABLE playlist_sources ADD COLUMN ignored_failure_ids TEXT').run()
  },
  /* v18: add type column to jobs for sync/repair distinction */
  (d) => {
    d.prepare("ALTER TABLE jobs ADD COLUMN type TEXT NOT NULL DEFAULT 'sync'").run()
  },
  /* v19: add skip_remove_extra_tracks to playlist_sources */
  (d) => {
    d.prepare('ALTER TABLE playlist_sources ADD COLUMN skip_remove_extra_tracks INTEGER NOT NULL DEFAULT 0').run()
  },
  /* v20: allow NULL source_id in download_tasks for download-only batches */
  (d) => {
    const existingColumns = d.prepare("PRAGMA table_info('download_tasks')").all() as Array<{ name: string; notnull: number }>
    const sourceId = existingColumns.find(column => column.name === 'source_id')
    if (sourceId && sourceId.notnull === 0) return
    d.prepare('DROP TABLE IF EXISTS download_tasks_new').run()
    d.prepare(`
      CREATE TABLE download_tasks_new (
        id              TEXT PRIMARY KEY,
        source_id       TEXT,
        song_id         INTEGER NOT NULL,
        song_name       TEXT NOT NULL,
        artist          TEXT NOT NULL DEFAULT '',
        album           TEXT NOT NULL DEFAULT '',
        status          TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','downloading','tagging','done','failed')),
        progress        INTEGER NOT NULL DEFAULT 0,
        file_path       TEXT,
        file_type       TEXT,
        quality         TEXT,
        error           TEXT,
        retry_count     INTEGER NOT NULL DEFAULT 0,
        job_id          TEXT,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL
      )
    `).run()
    d.prepare(`
      INSERT INTO download_tasks_new (
        id, source_id, song_id, song_name, artist, album, status, progress,
        file_path, file_type, quality, error, retry_count, job_id, created_at, updated_at
      )
      SELECT id, source_id, song_id, song_name, artist, album, status, progress,
        file_path, file_type, quality, error, retry_count, job_id, created_at, updated_at
      FROM download_tasks
    `).run()
    d.prepare('DROP TABLE download_tasks').run()
    d.prepare('ALTER TABLE download_tasks_new RENAME TO download_tasks').run()
    d.prepare('CREATE INDEX IF NOT EXISTS idx_download_tasks_status ON download_tasks(status)').run()
    d.prepare('CREATE INDEX IF NOT EXISTS idx_download_tasks_source ON download_tasks(source_id)').run()
    d.prepare('CREATE INDEX IF NOT EXISTS idx_download_tasks_time ON download_tasks(updated_at DESC)').run()
  },
  /* v21: artist_resolution_cache for MusicBrainz alias persistence */
  (d) => {
    d.prepare(`
      CREATE TABLE IF NOT EXISTS artist_resolution_cache (
        normalized_name TEXT PRIMARY KEY,
        original_name   TEXT NOT NULL,
        resolved_json   TEXT NOT NULL,
        source          TEXT NOT NULL DEFAULT 'original',
        confidence      INTEGER NOT NULL DEFAULT 0,
        mb_score        INTEGER,
        last_status     TEXT NOT NULL DEFAULT 'empty' CHECK(last_status IN ('success','empty','failed','disabled')),
        failure_count   INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TEXT,
        updated_at      TEXT NOT NULL
      )
    `).run()
    d.prepare('CREATE INDEX IF NOT EXISTS idx_artist_resolution_cache_updated ON artist_resolution_cache(updated_at)').run()
  },
  /* v22: ensure artist_resolution_cache uses normalized_name PK (rebuild if v21 was run with old schema) */
  (d) => {
    // Detect old schema: artist_name column existed in the first draft of v21
    const cols = d.prepare("PRAGMA table_info('artist_resolution_cache')").all() as Array<{ name: string }>
    const hasArtistName = cols.some((c) => c.name === 'artist_name')
    const hasNormalizedName = cols.some((c) => c.name === 'normalized_name')

    if (hasArtistName && !hasNormalizedName) {
      // Old schema with artist_name PK — migrate to normalized_name PK
      d.prepare(`
        CREATE TABLE artist_resolution_cache_new (
          normalized_name TEXT PRIMARY KEY,
          original_name   TEXT NOT NULL,
          resolved_json   TEXT NOT NULL,
          source          TEXT NOT NULL DEFAULT 'original',
          confidence      INTEGER NOT NULL DEFAULT 0,
          mb_score        INTEGER,
          last_status     TEXT NOT NULL DEFAULT 'empty' CHECK(last_status IN ('success','empty','failed','disabled')),
          failure_count   INTEGER NOT NULL DEFAULT 0,
          last_attempt_at TEXT,
          updated_at      TEXT NOT NULL
        )
      `).run()
      d.prepare(`
        INSERT OR IGNORE INTO artist_resolution_cache_new (normalized_name, original_name, resolved_json, source, confidence, mb_score, last_status, failure_count, last_attempt_at, updated_at)
        SELECT
          LOWER(REPLACE(artist_name, ' ', '')),
          artist_name,
          resolved_json,
          source,
          confidence,
          mb_score,
          last_status,
          failure_count,
          last_attempt_at,
          updated_at
        FROM artist_resolution_cache
      `).run()
      d.prepare('DROP TABLE artist_resolution_cache').run()
      d.prepare('ALTER TABLE artist_resolution_cache_new RENAME TO artist_resolution_cache').run()
      d.prepare('CREATE INDEX IF NOT EXISTS idx_artist_resolution_cache_updated ON artist_resolution_cache(updated_at)').run()
    }
  },
  /* v23: structured activity events */
  (d) => {
    d.prepare(`
      CREATE TABLE IF NOT EXISTS activity_events (
        id           TEXT PRIMARY KEY,
        domain       TEXT NOT NULL CHECK(domain IN ('sync','download','plex','user')),
        type         TEXT NOT NULL,
        severity     TEXT NOT NULL CHECK(severity IN ('info','success','warning','error')),
        occurred_at  TEXT NOT NULL,
        actor        TEXT NOT NULL CHECK(actor IN ('system','user')),
        title        TEXT NOT NULL,
        summary      TEXT NOT NULL,
        context      TEXT NOT NULL DEFAULT '{}',
        link         TEXT,
        group_key    TEXT
      )
    `).run()
    d.prepare('CREATE INDEX IF NOT EXISTS idx_activity_events_occurred_at ON activity_events(occurred_at DESC)').run()
    d.prepare('CREATE INDEX IF NOT EXISTS idx_activity_events_domain ON activity_events(domain)').run()
    d.prepare('CREATE INDEX IF NOT EXISTS idx_activity_events_severity ON activity_events(severity)').run()
    d.prepare('CREATE INDEX IF NOT EXISTS idx_activity_events_group_key ON activity_events(group_key)').run()
  },
  /* v24: persist cover URLs for sync sources */
  (d) => {
    d.prepare("ALTER TABLE playlist_sources ADD COLUMN cover_url TEXT NOT NULL DEFAULT ''").run()
  },
  /* v25: unified task runs + compatible download run link */
  (d) => {
    d.prepare(`
      CREATE TABLE IF NOT EXISTS task_runs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        trigger TEXT NOT NULL DEFAULT 'system',
        started_at TEXT NOT NULL,
        finished_at TEXT,
        status TEXT NOT NULL CHECK(status IN ('running','success','partial','failed','cancelled')),
        summary TEXT NOT NULL DEFAULT '',
        total_items INTEGER NOT NULL DEFAULT 0,
        success_items INTEGER NOT NULL DEFAULT 0,
        failed_items INTEGER NOT NULL DEFAULT 0,
        skipped_items INTEGER NOT NULL DEFAULT 0,
        removed_items INTEGER NOT NULL DEFAULT 0,
        warnings INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT '',
        target TEXT NOT NULL DEFAULT '',
        duration_ms INTEGER NOT NULL DEFAULT 0,
        data TEXT NOT NULL DEFAULT '{}'
      )
    `).run()
    d.prepare('CREATE INDEX IF NOT EXISTS idx_task_runs_started ON task_runs(started_at DESC)').run()
    d.prepare('CREATE INDEX IF NOT EXISTS idx_task_runs_status ON task_runs(status)').run()
    d.prepare('CREATE INDEX IF NOT EXISTS idx_task_runs_type ON task_runs(type)').run()
    if (tableExists(d, 'jobs')) {
      d.prepare(`
        INSERT OR IGNORE INTO task_runs (
          id, type, trigger, started_at, finished_at, status, summary,
          total_items, success_items, failed_items, skipped_items, removed_items,
          warnings, source, target, duration_ms, data
        )
        SELECT id, COALESCE(type, 'sync'), 'system', started_at, finished_at, status, summary,
          total_songs, success_songs, failed_songs, skipped_songs, COALESCE(removed_songs, 0),
          warnings, source, target, duration_ms, data
        FROM jobs
      `).run()
    }

    const columns = d.prepare("PRAGMA table_info('download_tasks')").all() as Array<{ name: string }>
    if (!columns.some(column => column.name === 'run_id')) {
      d.prepare('ALTER TABLE download_tasks ADD COLUMN run_id TEXT').run()
    }
    d.prepare('UPDATE download_tasks SET run_id = job_id WHERE run_id IS NULL AND job_id IS NOT NULL').run()
    d.prepare('CREATE INDEX IF NOT EXISTS idx_download_tasks_run ON download_tasks(run_id)').run()

    const batches = d.prepare(`
      SELECT COALESCE(run_id, job_id) AS run_id,
        MIN(created_at) AS started_at,
        MAX(updated_at) AS finished_at,
        COUNT(*) AS total_items,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS success_items,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_items,
        SUM(CASE WHEN status IN ('pending','downloading','tagging') THEN 1 ELSE 0 END) AS active_items
      FROM download_tasks
      WHERE source_id IS NULL AND COALESCE(run_id, job_id) IS NOT NULL
      GROUP BY COALESCE(run_id, job_id)
    `).all() as Array<{
      run_id: string
      started_at: string
      finished_at: string
      total_items: number
      success_items: number
      failed_items: number
      active_items: number
    }>
    const insertRun = d.prepare(`
      INSERT OR IGNORE INTO task_runs (
        id, type, trigger, started_at, finished_at, status, summary,
        total_items, success_items, failed_items, skipped_items, removed_items,
        warnings, source, target, duration_ms, data
      ) VALUES (?, 'manual_download', 'user', ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, '手动下载', '本地磁盘', ?, ?)
    `)
    for (const batch of batches) {
      const status = batch.active_items > 0
        ? 'running'
        : batch.failed_items === 0
          ? 'success'
          : batch.success_items > 0
            ? 'partial'
            : 'failed'
      const finishedAt = status === 'running' ? null : batch.finished_at
      const durationMs = Math.max(0, new Date(batch.finished_at).getTime() - new Date(batch.started_at).getTime())
      const summary = `手动下载 ${batch.total_items} 首歌曲`
      insertRun.run(
        batch.run_id, batch.started_at, finishedAt, status, summary,
        batch.total_items, batch.success_items, batch.failed_items, durationMs,
        JSON.stringify({
          id: batch.run_id, type: 'manual_download', trigger: 'user',
          startedAt: batch.started_at, finishedAt, status, durationMs, summary,
          source: '手动下载', target: '本地磁盘',
          totalSongs: batch.total_items, successSongs: batch.success_items,
          failedSongs: batch.failed_items, skippedSongs: 0, removedSongs: 0,
          warnings: 0, dryRun: false, steps: [], songs: [], config: {},
        }),
      )
    }
  },
  /* v26: lightweight failure record lifecycle */
  (d) => {
    d.prepare(`
      CREATE TABLE IF NOT EXISTS failure_records (
        id TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL UNIQUE,
        subject_key TEXT NOT NULL,
        song_id INTEGER,
        song_name TEXT NOT NULL,
        artist TEXT NOT NULL DEFAULT '',
        source_id TEXT,
        source_name TEXT NOT NULL DEFAULT '',
        run_id TEXT,
        run_type TEXT NOT NULL,
        failure_kind TEXT NOT NULL,
        failure_reason TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','ignored','resolved')),
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        ignored_at TEXT,
        resolved_at TEXT,
        occurrence_count INTEGER NOT NULL DEFAULT 1,
        retry_count INTEGER NOT NULL DEFAULT 0,
        download_task_ids TEXT
      )
    `).run()
    d.prepare('CREATE INDEX IF NOT EXISTS idx_failure_records_status ON failure_records(status, last_seen_at DESC)').run()
    d.prepare('CREATE INDEX IF NOT EXISTS idx_failure_records_run ON failure_records(run_id)').run()
    d.prepare('CREATE INDEX IF NOT EXISTS idx_failure_records_subject ON failure_records(subject_key)').run()
  },
  /* v27: normalize failure record time bounds created by out-of-order history replay */
  (d) => {
    d.prepare(`
      UPDATE failure_records
      SET first_seen_at = last_seen_at,
          last_seen_at = first_seen_at
      WHERE first_seen_at > last_seen_at
    `).run()
  },
  /* v28: make failure history replay idempotent and repair inflated counters */
  (d) => {
    d.prepare(`
      CREATE TABLE IF NOT EXISTS failure_occurrences (
        fingerprint TEXT NOT NULL,
        occurrence_key TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        PRIMARY KEY (fingerprint, occurrence_key)
      )
    `).run()
    d.prepare('CREATE INDEX IF NOT EXISTS idx_failure_occurrences_fingerprint ON failure_occurrences(fingerprint)').run()
    d.prepare('UPDATE failure_records SET occurrence_count = 0').run()
  },
  /* v29: explicit many-to-many membership between task runs and sync sources */
  ensureTaskRunSources,
  /* v30: compatibility slot for databases whose historical migration numbering was offset by one */
  ensureTaskRunSources,
  /* v31: remove legacy jobs table after its records have been migrated into task_runs */
  migrateLegacyJobsToTaskRunsAndDrop,
  /* v32: download task idempotency and processing leases */
  ensureDownloadTaskProcessingColumns,
  /* v33: admin authentication, sessions, and setup state */
  ensureAuthTables,
  /* v34: durable song identity, review queue and MusicBrainz recording cache */
  (d) => {
    d.exec(`
      CREATE TABLE IF NOT EXISTS song_identity_bindings (
        netease_song_id INTEGER PRIMARY KEY,
        plex_section_key TEXT NOT NULL DEFAULT '', plex_file_path TEXT NOT NULL,
        plex_rating_key TEXT, mb_recording_id TEXT,
        binding_method TEXT NOT NULL CHECK(binding_method IN ('path','mb_recording','provider_guid','metadata','manual','migrated')),
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','stale','unbound')),
        evidence_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL, last_verified_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_song_identity_bindings_path ON song_identity_bindings(plex_file_path);
      CREATE INDEX IF NOT EXISTS idx_song_identity_bindings_rating_key ON song_identity_bindings(plex_rating_key);
      CREATE INDEX IF NOT EXISTS idx_song_identity_bindings_recording ON song_identity_bindings(mb_recording_id);
      CREATE TABLE IF NOT EXISTS song_match_reviews (
        id TEXT PRIMARY KEY, netease_song_id INTEGER NOT NULL, source_id TEXT, run_id TEXT,
        candidate_plex_file_path TEXT, candidate_plex_rating_key TEXT,
        candidate_mb_recording_id TEXT, evidence_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected','unbound','superseded')),
        decision TEXT, created_at TEXT NOT NULL, decided_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_song_match_reviews_queue ON song_match_reviews(status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_song_match_reviews_song ON song_match_reviews(netease_song_id, status);
      CREATE TABLE IF NOT EXISTS musicbrainz_recording_cache (
        lookup_key TEXT PRIMARY KEY, resolved_json TEXT NOT NULL,
        last_status TEXT NOT NULL CHECK(last_status IN ('success','empty','failed','disabled')),
        score INTEGER, failure_count INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TEXT, updated_at TEXT NOT NULL
      );
    `)
  },
  /* v35: repair the v21 artist cache schema even on databases that already ran v22 */
  repairArtistResolutionCache,
  /* v36: retain durable local-file provenance beyond download task cleanup */
  (d) => {
    d.exec(`
      CREATE TABLE IF NOT EXISTS local_media_assets (
        netease_song_id INTEGER PRIMARY KEY,
        file_path TEXT NOT NULL,
        provenance TEXT NOT NULL CHECK(provenance IN ('download_task','legacy_download_task','computed','manual')),
        source_task_id TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','missing','replaced')),
        file_size INTEGER,
        file_mtime_ms INTEGER,
        evidence_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_verified_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_local_media_assets_path ON local_media_assets(file_path);
      CREATE INDEX IF NOT EXISTS idx_local_media_assets_status ON local_media_assets(status);
    `)

    d.exec(`
      INSERT OR IGNORE INTO local_media_assets (
        netease_song_id, file_path, provenance, source_task_id, status,
        evidence_json, created_at, updated_at, last_verified_at
      )
      SELECT song_id, file_path, 'legacy_download_task', id, 'active',
        json_object('migratedFrom', 'download_tasks'), created_at, updated_at, NULL
      FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY song_id ORDER BY updated_at DESC, created_at DESC) AS row_number
        FROM download_tasks
        WHERE status = 'done' AND file_path IS NOT NULL AND TRIM(file_path) != ''
      )
      WHERE row_number = 1
    `)
  },
  /* v37: canonical relative identities, deterministic candidate keys and review occurrences */
  ensureSongIdentityReviewSchema,
  /* v38: content fingerprints and observation/comparison cursors */
  ensurePlaylistSourceSyncCursorColumns,
  /* v39: persist MusicBrainz ambiguity as a first-class cache status */
  ensureMusicBrainzRecordingCacheStatuses,
  /* v40: consecutive observations for deletion-safe unknown playlist extras */
  ensurePlaylistExtraObservationTable,
  /* v41: typed Plex MBID to MusicBrainz recording mapping */
  ensureMusicBrainzIdMappingCache,
  /* v42: high-confidence metadata as an auditable binding method */
  ensureSongIdentityBindingMethods,
  /* v43: playlist occurrence snapshots and immutable identity audit events */
  ensureMatchManagementSchema,
  /* v44: distinguish YunPlex-managed media from externally discovered files */
  ensureLocalMediaAssetOwnership,
  /* v45: true nullable per-source overrides */
  ensureNullableSourceSyncOverrides,
  /* v46: retire weak metadata identities and the legacy lookup cache */
  retireWeakMetadataBindingsAndLookupCache,
  /* v47: per-source missing-media download policy */
  ensureDownloadWhenMediaMissingOverride,
  /* v48: remove the retired user-facing activity projection and its rows */
  retireActivityEvents,
  /* v49: remove the unused persisted sync-state projection */
  retireSyncState,
]
}
