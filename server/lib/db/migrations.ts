import Database from 'better-sqlite3'
import { createHistoricalMigrations } from './migration-history'
import { isIdempotentSchemaError, tableExists } from './introspection'
import { buildMatchReviewCandidateKey, normalizePlexPath, normalizePlexRelativePath } from '../sync/identity-normalization'

/**
 * Safe on every boot. Some installations can have an advanced user_version
 * while still missing columns from a partially applied migration, so columns
 * are repaired independently without rebuilding or rewriting source rows.
 */
export function ensurePlaylistSourceSyncCursorColumns(d: Database.Database): void {
  if (!tableExists(d, 'playlist_sources')) return
  const columns = new Set(
    (d.prepare("PRAGMA table_info('playlist_sources')").all() as Array<{ name: string }>)
      .map(column => column.name),
  )
  const definitions = [
    ['last_observed_plex_fingerprint', 'TEXT'],
    ['last_applied_plex_fingerprint', 'TEXT'],
    ['last_observed_netease_cursor', 'TEXT'],
    ['last_compared_netease_cursor', 'TEXT'],
    ['last_observed_at', 'TEXT'],
    ['last_compared_at', 'TEXT'],
  ] as const

  for (const [name, type] of definitions) {
    if (!columns.has(name)) d.prepare(`ALTER TABLE playlist_sources ADD COLUMN ${name} ${type}`).run()
  }
}

/** Convert historical one-way booleans into true nullable source overrides. */
export function ensureNullableSourceSyncOverrides(d: Database.Database): void {
  if (!tableExists(d, 'playlist_sources')) return
  const overrideColumns = ['force_full_compare', 'skip_plex_playlist', 'skip_remove_extra_tracks'] as const

  d.transaction(() => {
    for (const column of overrideColumns) {
      const info = d.prepare("PRAGMA table_info('playlist_sources')").all() as Array<{ name: string; notnull: number }>
      const current = info.find(item => item.name === column)
      if (!current) {
        d.prepare(`ALTER TABLE playlist_sources ADD COLUMN ${column} INTEGER`).run()
        continue
      }
      if (current.notnull === 0) continue

      const legacyColumn = `${column}_legacy_v45`
      d.prepare(`ALTER TABLE playlist_sources RENAME COLUMN ${column} TO ${legacyColumn}`).run()
      d.prepare(`ALTER TABLE playlist_sources ADD COLUMN ${column} INTEGER`).run()
      d.prepare(`
        UPDATE playlist_sources
        SET ${column} = CASE WHEN ${legacyColumn} = 1 THEN 1 ELSE NULL END
      `).run()
      d.prepare(`ALTER TABLE playlist_sources DROP COLUMN ${legacyColumn}`).run()
    }
  })()
}

/** Add the nullable source override without changing existing source behavior. */
export function ensureDownloadWhenMediaMissingOverride(d: Database.Database): void {
  if (!tableExists(d, 'playlist_sources')) return
  const columns = new Set(
    (d.prepare("PRAGMA table_info('playlist_sources')").all() as Array<{ name: string }>)
      .map(column => column.name),
  )
  if (!columns.has('download_when_media_missing')) {
    d.prepare('ALTER TABLE playlist_sources ADD COLUMN download_when_media_missing INTEGER').run()
  }
}

/** Remove weak automatic identities and the obsolete lookup cache. */
export function retireWeakMetadataBindingsAndLookupCache(d: Database.Database): void {
  const now = new Date().toISOString()
  d.transaction(() => {
    const activeMetadataSongIds = tableExists(d, 'song_identity_bindings')
      ? (d.prepare(`
          SELECT netease_song_id
          FROM song_identity_bindings
          WHERE binding_method = 'metadata' AND status = 'active'
        `).all() as Array<{ netease_song_id: number }>).map(row => row.netease_song_id)
      : []
    if (tableExists(d, 'song_identity_bindings')) {
      d.prepare(`
        UPDATE song_identity_bindings
        SET status = 'stale', updated_at = ?
        WHERE binding_method = 'metadata' AND status = 'active'
      `).run(now)
    }
    if (
      tableExists(d, 'playlist_sources')
      && tableExists(d, 'playlist_source_track_occurrences')
      && activeMetadataSongIds.length > 0
    ) {
      d.prepare(`
        UPDATE playlist_sources
        SET requires_match_reconcile = 1, updated_at = ?
        WHERE id IN (
          SELECT DISTINCT occurrence.source_id
          FROM playlist_source_track_occurrences occurrence
          WHERE occurrence.netease_song_id IN (${activeMetadataSongIds.map(() => '?').join(', ')})
        )
      `).run(now, ...activeMetadataSongIds)
    }
    d.prepare('DROP TABLE IF EXISTS song_lookup').run()
  })()
}

/** Expand the historical recording-cache CHECK without dropping cached data. */
export function ensureMusicBrainzRecordingCacheStatuses(d: Database.Database): void {
  if (!tableExists(d, 'musicbrainz_recording_cache')) return
  const table = d.prepare(`
    SELECT sql FROM sqlite_master
    WHERE type = 'table' AND name = 'musicbrainz_recording_cache'
  `).get() as { sql: string | null } | undefined
  if (table?.sql?.includes("'ambiguous'")) return

  d.transaction(() => {
    d.prepare('DROP TABLE IF EXISTS musicbrainz_recording_cache_status_migration').run()
    d.exec(`
      CREATE TABLE musicbrainz_recording_cache_status_migration (
        lookup_key TEXT PRIMARY KEY,
        resolved_json TEXT NOT NULL,
        last_status TEXT NOT NULL CHECK(last_status IN ('success','ambiguous','empty','failed','disabled')),
        score INTEGER,
        failure_count INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TEXT,
        updated_at TEXT NOT NULL
      );
      INSERT INTO musicbrainz_recording_cache_status_migration (
        lookup_key, resolved_json, last_status, score, failure_count, last_attempt_at, updated_at
      )
      SELECT lookup_key, resolved_json, last_status, score, failure_count, last_attempt_at, updated_at
      FROM musicbrainz_recording_cache;
      DROP TABLE musicbrainz_recording_cache;
      ALTER TABLE musicbrainz_recording_cache_status_migration RENAME TO musicbrainz_recording_cache;
    `)
  })()
}

/** Durable typed resolution for Plex's entity-ambiguous mbid:// GUIDs. */
export function ensureMusicBrainzIdMappingCache(d: Database.Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS musicbrainz_id_mapping_cache (
      input_mbid TEXT PRIMARY KEY,
      resolved_json TEXT NOT NULL,
      entity_type TEXT NOT NULL CHECK(entity_type IN ('recording','release_track','unknown')),
      status TEXT NOT NULL CHECK(status IN ('success','ambiguous','empty','failed')),
      recording_id TEXT,
      failure_count INTEGER NOT NULL DEFAULT 0,
      last_attempt_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_musicbrainz_id_mapping_recording
      ON musicbrainz_id_mapping_cache(recording_id);
  `)
}

/** Expand binding evidence methods without discarding established identities. */
export function ensureSongIdentityBindingMethods(d: Database.Database): void {
  if (!tableExists(d, 'song_identity_bindings')) return
  const table = d.prepare(`
    SELECT sql FROM sqlite_master
    WHERE type = 'table' AND name = 'song_identity_bindings'
  `).get() as { sql: string | null } | undefined
  if (table?.sql?.includes("'provider_guid'")) return

  d.transaction(() => {
    d.prepare('DROP TABLE IF EXISTS song_identity_bindings_method_migration').run()
    d.exec(`
      CREATE TABLE song_identity_bindings_method_migration (
        netease_song_id INTEGER PRIMARY KEY,
        plex_section_key TEXT NOT NULL DEFAULT '',
        plex_file_path TEXT NOT NULL,
        plex_relative_path TEXT NOT NULL DEFAULT '',
        plex_rating_key TEXT,
        mb_recording_id TEXT,
        binding_method TEXT NOT NULL CHECK(binding_method IN ('path','mb_recording','provider_guid','metadata','manual','migrated')),
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','stale','unbound')),
        evidence_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_verified_at TEXT
      );
      INSERT INTO song_identity_bindings_method_migration (
        netease_song_id, plex_section_key, plex_file_path, plex_relative_path,
        plex_rating_key, mb_recording_id, binding_method, status, evidence_json,
        created_at, updated_at, last_verified_at
      ) SELECT
        netease_song_id, plex_section_key, plex_file_path, plex_relative_path,
        plex_rating_key, mb_recording_id, binding_method, status, evidence_json,
        created_at, updated_at, last_verified_at
      FROM song_identity_bindings;
      DROP TABLE song_identity_bindings;
      ALTER TABLE song_identity_bindings_method_migration RENAME TO song_identity_bindings;
      CREATE INDEX IF NOT EXISTS idx_song_identity_bindings_path ON song_identity_bindings(plex_file_path);
      CREATE INDEX IF NOT EXISTS idx_song_identity_bindings_rating_key ON song_identity_bindings(plex_rating_key);
      CREATE INDEX IF NOT EXISTS idx_song_identity_bindings_recording ON song_identity_bindings(mb_recording_id);
      CREATE INDEX IF NOT EXISTS idx_song_identity_bindings_relative_path
        ON song_identity_bindings(plex_section_key, plex_relative_path);
    `)
  })()
}

function tableHasColumn(d: Database.Database, tableName: string, columnName: string): boolean {
  if (!tableExists(d, tableName)) return false
  return (d.prepare(`PRAGMA table_info('${tableName}')`).all() as Array<{ name: string }>)
    .some(column => column.name === columnName)
}

/**
 * Discovery provenance and identity ownership are separate facts. Historical
 * successful download tasks stay managed for compatibility; new tasks record
 * whether YunPlex actually wrote audio bytes.
 */
export function ensureLocalMediaAssetOwnership(d: Database.Database): void {
  if (!tableExists(d, 'local_media_assets')) return
  if (!tableHasColumn(d, 'local_media_assets', 'ownership')) {
    d.prepare(`
      ALTER TABLE local_media_assets
      ADD COLUMN ownership TEXT NOT NULL DEFAULT 'external'
        CHECK(ownership IN ('managed','external'))
    `).run()
  }
  d.prepare(`
    UPDATE local_media_assets
    SET ownership = 'managed'
    WHERE provenance IN ('download_task','legacy_download_task')
      AND (
        json_extract(evidence_json, '$.audioOperation') IS NULL
        OR json_extract(evidence_json, '$.audioOperation') != 'adopted_existing'
      )
  `).run()
}

/**
 * Re-entrant repair for the match-management identity audit schema. It is
 * deliberately safe to execute at every boot because historical databases can
 * have an advanced user_version after a partially applied migration.
 */
export function ensureMatchManagementSchema(d: Database.Database): void {
  if (!tableExists(d, 'playlist_sources')) return
  if (!tableHasColumn(d, 'playlist_sources', 'requires_match_reconcile')) {
    d.prepare('ALTER TABLE playlist_sources ADD COLUMN requires_match_reconcile INTEGER NOT NULL DEFAULT 0').run()
  }

  d.exec(`
    CREATE TABLE IF NOT EXISTS playlist_source_track_occurrences (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES playlist_sources(id) ON DELETE CASCADE,
      netease_song_id INTEGER NOT NULL,
      occurrence INTEGER NOT NULL,
      position INTEGER NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      artists_json TEXT NOT NULL DEFAULT '[]',
      album_id INTEGER,
      album_name TEXT NOT NULL DEFAULT '',
      cover_url TEXT NOT NULL DEFAULT '',
      track_number INTEGER,
      disc_number INTEGER,
      duration_ms INTEGER,
      metadata_complete INTEGER NOT NULL DEFAULT 0,
      membership_status TEXT NOT NULL DEFAULT 'current'
        CHECK(membership_status IN ('current','removed')),
      removal_reason TEXT
        CHECK(removal_reason IS NULL OR removal_reason IN ('netease_removed','sync_limit_excluded')),
      last_song_status TEXT,
      last_run_id TEXT,
      match_trace_json TEXT,
      last_error_json TEXT,
      alignment_status TEXT NOT NULL DEFAULT 'unknown'
        CHECK(alignment_status IN ('aligned','pending','missing','unknown')),
      aligned_plex_rating_key TEXT,
      aligned_plex_relative_path TEXT,
      aligned_binding_updated_at TEXT,
      aligned_at TEXT,
      first_observed_at TEXT NOT NULL,
      last_observed_at TEXT NOT NULL,
      removed_at TEXT,
      UNIQUE(source_id, netease_song_id, occurrence)
    );
    CREATE INDEX IF NOT EXISTS idx_playlist_track_occurrences_order
      ON playlist_source_track_occurrences(source_id, membership_status, position);
    CREATE INDEX IF NOT EXISTS idx_playlist_track_occurrences_song
      ON playlist_source_track_occurrences(netease_song_id, membership_status);

    CREATE TABLE IF NOT EXISTS song_identity_events (
      id TEXT PRIMARY KEY,
      netease_song_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      actor_type TEXT NOT NULL CHECK(actor_type IN ('system','admin')),
      source_id TEXT,
      run_id TEXT,
      review_id TEXT,
      previous_binding_json TEXT,
      next_binding_json TEXT,
      evidence_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_song_identity_events_song
      ON song_identity_events(netease_song_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_song_identity_events_source
      ON song_identity_events(source_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_song_identity_events_type
      ON song_identity_events(event_type, actor_type, created_at DESC);
  `)

  // Local-only backfill. track_id_snapshot is the last successfully compared
  // managed order; run JSON enriches it when available, but is never required.
  const sources = d.prepare(`
    SELECT id, track_id_snapshot, last_job_id, updated_at
    FROM playlist_sources
    WHERE track_id_snapshot IS NOT NULL AND TRIM(track_id_snapshot) != ''
  `).all() as Array<{
    id: string
    track_id_snapshot: string
    last_job_id: string | null
    updated_at: string
  }>
  const insertOccurrence = d.prepare(`
    INSERT INTO playlist_source_track_occurrences (
      id, source_id, netease_song_id, occurrence, position,
      title, artists_json, album_name, metadata_complete,
      membership_status, last_run_id, alignment_status,
      first_observed_at, last_observed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'current', ?, 'unknown', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = CASE WHEN metadata_complete = 0 AND excluded.metadata_complete = 1 THEN excluded.title ELSE title END,
      artists_json = CASE WHEN metadata_complete = 0 AND excluded.metadata_complete = 1 THEN excluded.artists_json ELSE artists_json END,
      album_name = CASE WHEN metadata_complete = 0 AND excluded.metadata_complete = 1 THEN excluded.album_name ELSE album_name END,
      metadata_complete = MAX(metadata_complete, excluded.metadata_complete),
      last_run_id = COALESCE(last_run_id, excluded.last_run_id)
  `)
  for (const source of sources) {
    let ids: number[] = []
    try {
      const parsed = JSON.parse(source.track_id_snapshot) as unknown
      if (Array.isArray(parsed)) ids = parsed.filter((id): id is number => typeof id === 'number' && Number.isFinite(id))
    } catch {
      continue
    }
    let runSongs: Array<Record<string, unknown>> = []
    let sourceRunId = source.last_job_id
    let run = sourceRunId
      ? d.prepare('SELECT data FROM task_runs WHERE id = ?').get(sourceRunId) as { data: string } | undefined
      : undefined
    if (!run) {
      const latest = d.prepare(`
        SELECT task_runs.id, task_runs.data
        FROM task_runs
        JOIN task_run_sources ON task_run_sources.run_id = task_runs.id
        WHERE task_run_sources.source_id = ?
        ORDER BY task_runs.started_at DESC
        LIMIT 1
      `).get(source.id) as { id: string; data: string } | undefined
      sourceRunId = latest?.id ?? null
      run = latest
    }
    if (run) {
      try {
        const parsed = JSON.parse(run.data) as { songs?: unknown }
        if (Array.isArray(parsed?.songs)) runSongs = parsed.songs.filter(
          (song): song is Record<string, unknown> => Boolean(song && typeof song === 'object' && !Array.isArray(song)),
        )
      } catch {
        // A malformed historical run must not block startup or ID backfill.
      }
    }
    const occurrences = new Map<number, number>()
    ids.forEach((songId, position) => {
      const occurrence = occurrences.get(songId) ?? 0
      occurrences.set(songId, occurrence + 1)
      const song = runSongs.find(candidate =>
        candidate.sourceId === source.id
        && candidate.neteaseSongId === songId
        && candidate.neteaseIndex === position,
      )
      insertOccurrence.run(
        `${source.id}:${songId}:${occurrence}`,
        source.id,
        songId,
        occurrence,
        position,
        typeof song?.songName === 'string' ? song.songName : '',
        JSON.stringify(typeof song?.artist === 'string' && song.artist ? [song.artist] : []),
        typeof song?.album === 'string' ? song.album : '',
        song ? 1 : 0,
        sourceRunId,
        source.updated_at,
        source.updated_at,
      )
    })
  }

  // Existing bindings predate the append-only audit log. Add one immutable
  // baseline event per binding so future history has a trustworthy origin.
  d.exec(`
    INSERT OR IGNORE INTO song_identity_events (
      id, netease_song_id, event_type, actor_type,
      previous_binding_json, next_binding_json, evidence_json, created_at
    )
    SELECT
      'migration-binding-' || netease_song_id,
      netease_song_id,
      'migration_snapshot',
      'system',
      NULL,
      json_object(
        'neteaseSongId', netease_song_id,
        'plexSectionKey', plex_section_key,
        'plexFilePath', plex_file_path,
        'plexRelativePath', plex_relative_path,
        'plexRatingKey', plex_rating_key,
        'mbRecordingId', mb_recording_id,
        'bindingMethod', binding_method,
        'status', status,
        'evidence', json(evidence_json),
        'createdAt', created_at,
        'updatedAt', updated_at,
        'lastVerifiedAt', last_verified_at
      ),
      json_object('migratedFrom', 'song_identity_bindings'),
      created_at
    FROM song_identity_bindings
  `)
}

function ensurePlaylistExtraObservationTable(d: Database.Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS playlist_extra_observations (
      source_id TEXT NOT NULL,
      plex_playlist_rating_key TEXT NOT NULL,
      identity_key TEXT NOT NULL,
      plex_rating_key TEXT NOT NULL,
      plex_file_path TEXT,
      consecutive_observations INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'observing' CHECK(status IN ('observing','absent','removed')),
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      last_run_id TEXT NOT NULL,
      removed_at TEXT,
      removed_run_id TEXT,
      PRIMARY KEY (source_id, plex_playlist_rating_key, identity_key),
      FOREIGN KEY (source_id) REFERENCES playlist_sources(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_playlist_extra_observations_status
      ON playlist_extra_observations(source_id, plex_playlist_rating_key, status);
  `)
}

function configuredPlexSectionRoot(d: Database.Database): string {
  if (!tableExists(d, 'config')) return ''
  const row = d.prepare("SELECT value FROM config WHERE key = 'app'").get() as { value: string } | undefined
  if (!row) return ''
  try {
    const config = JSON.parse(row.value) as { download?: { plexLibraryPathPrefix?: unknown } }
    return typeof config.download?.plexLibraryPathPrefix === 'string'
      ? normalizePlexPath(config.download.plexLibraryPathPrefix)
      : ''
  } catch {
    return ''
  }
}

function inferReviewEvidenceType(row: {
  candidate_mb_recording_id: string | null
  candidate_plex_file_path: string | null
  decision: string | null
  evidence_json: string
}): 'path' | 'mb_recording' | 'metadata' | 'historical' | 'manual' | 'migration' {
  if (row.decision === 'manual_unbind' || row.decision === 'manual_accept' || row.decision === 'manual_reject') return 'manual'
  if (row.decision?.includes('migrat')) return 'migration'
  if (row.candidate_mb_recording_id) return 'mb_recording'
  try {
    const evidence = JSON.parse(row.evidence_json) as Record<string, unknown>
    const explicit = evidence.evidenceType
    if (explicit === 'path' || explicit === 'mb_recording' || explicit === 'metadata'
      || explicit === 'historical' || explicit === 'manual' || explicit === 'migration') return explicit
    if (evidence.pathExact === true || evidence.source === 'path') return 'path'
    if (evidence.reason || row.candidate_plex_file_path) return 'metadata'
  } catch {
    // Malformed historical evidence remains visible as unverified history.
  }
  return 'historical'
}

/** Idempotent repair for databases whose user_version advanced while an older
 * identity/review table shape was still present. */
function repairSongIdentityReviewSchema(d: Database.Database): void {
  if (!tableExists(d, 'song_identity_bindings') || !tableExists(d, 'song_match_reviews')) return

  if (!tableHasColumn(d, 'song_identity_bindings', 'plex_relative_path')) {
    d.prepare("ALTER TABLE song_identity_bindings ADD COLUMN plex_relative_path TEXT NOT NULL DEFAULT ''").run()
  }
  if (!tableHasColumn(d, 'song_match_reviews', 'candidate_key')) {
    d.prepare("ALTER TABLE song_match_reviews ADD COLUMN candidate_key TEXT NOT NULL DEFAULT ''").run()
  }
  if (!tableHasColumn(d, 'song_match_reviews', 'evidence_type')) {
    d.prepare("ALTER TABLE song_match_reviews ADD COLUMN evidence_type TEXT NOT NULL DEFAULT 'historical'").run()
  }

  // Candidate keys can converge after Unicode normalization or a section-root
  // correction. Rebuild the partial unique index after consolidating them.
  d.prepare('DROP INDEX IF EXISTS idx_song_match_reviews_pending_candidate').run()

  d.exec(`
    CREATE TABLE IF NOT EXISTS song_match_review_occurrences (
      review_id TEXT NOT NULL REFERENCES song_match_reviews(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL DEFAULT '',
      run_id TEXT NOT NULL DEFAULT '',
      observed_at TEXT NOT NULL,
      PRIMARY KEY (review_id, source_id, run_id)
    );
    CREATE INDEX IF NOT EXISTS idx_song_match_review_occurrences_source
      ON song_match_review_occurrences(source_id, review_id);
    CREATE INDEX IF NOT EXISTS idx_song_identity_bindings_relative_path
      ON song_identity_bindings(plex_section_key, plex_relative_path);
    CREATE INDEX IF NOT EXISTS idx_song_match_reviews_source
      ON song_match_reviews(source_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_song_match_reviews_evidence
      ON song_match_reviews(evidence_type, status, created_at DESC);
  `)

  const sectionRoot = configuredPlexSectionRoot(d)
  const bindingRows = d.prepare(`
    SELECT netease_song_id, plex_file_path, plex_relative_path
    FROM song_identity_bindings
  `).all() as Array<{ netease_song_id: number; plex_file_path: string; plex_relative_path: string }>
  const updateBindingPath = d.prepare('UPDATE song_identity_bindings SET plex_relative_path = ? WHERE netease_song_id = ?')
  for (const row of bindingRows) {
    const relativePath = normalizePlexRelativePath(row.plex_file_path, sectionRoot)
    const pathWithinRoot = sectionRoot && normalizePlexPath(row.plex_file_path).startsWith(`${sectionRoot}/`)
    if (!row.plex_relative_path || pathWithinRoot) updateBindingPath.run(relativePath, row.netease_song_id)
  }

  const reviewRows = d.prepare(`
    SELECT id, netease_song_id, source_id, run_id, candidate_plex_file_path,
      candidate_plex_rating_key, candidate_mb_recording_id, candidate_key,
      evidence_type, evidence_json, decision, created_at
    FROM song_match_reviews
  `).all() as Array<{
    id: string; netease_song_id: number; source_id: string | null; run_id: string | null
    candidate_plex_file_path: string | null; candidate_plex_rating_key: string | null
    candidate_mb_recording_id: string | null; candidate_key: string; evidence_type: string
    evidence_json: string; decision: string | null; created_at: string
  }>
  const updateReviewIdentity = d.prepare('UPDATE song_match_reviews SET candidate_key = ?, evidence_type = ? WHERE id = ?')
  const insertOccurrence = d.prepare(`
    INSERT OR IGNORE INTO song_match_review_occurrences (review_id, source_id, run_id, observed_at)
    VALUES (?, ?, ?, ?)
  `)
  for (const row of reviewRows) {
    const candidateKey = buildMatchReviewCandidateKey({
      neteaseSongId: row.netease_song_id,
      candidatePlexFilePath: row.candidate_plex_file_path,
      candidatePlexRatingKey: row.candidate_plex_rating_key,
      candidateMbRecordingId: row.candidate_mb_recording_id,
      plexSectionRoot: sectionRoot,
    })
    const evidenceType = inferReviewEvidenceType(row)
    if (row.candidate_key !== candidateKey || row.evidence_type !== evidenceType) {
      updateReviewIdentity.run(candidateKey, evidenceType, row.id)
    }
    if (row.source_id || row.run_id) {
      insertOccurrence.run(row.id, row.source_id ?? '', row.run_id ?? '', row.created_at)
    }
  }

  const duplicates = d.prepare(`
    SELECT candidate_key FROM song_match_reviews
    WHERE status = 'pending' AND candidate_key != ''
    GROUP BY candidate_key HAVING COUNT(*) > 1
  `).all() as Array<{ candidate_key: string }>
  const duplicateRows = d.prepare(`
    SELECT id, source_id, run_id, created_at FROM song_match_reviews
    WHERE status = 'pending' AND candidate_key = ?
    ORDER BY CASE evidence_type
      WHEN 'manual' THEN 0 WHEN 'path' THEN 1 WHEN 'mb_recording' THEN 2
      WHEN 'migration' THEN 3 WHEN 'metadata' THEN 4 ELSE 5 END,
      created_at DESC, id DESC
  `)
  const supersede = d.prepare(`
    UPDATE song_match_reviews
    SET status = 'superseded', decision = 'duplicate_candidate', decided_at = ?
    WHERE id = ?
  `)
  const now = new Date().toISOString()
  for (const duplicate of duplicates) {
    const rows = duplicateRows.all(duplicate.candidate_key) as Array<{
      id: string; source_id: string | null; run_id: string | null; created_at: string
    }>
    const keep = rows[0]
    if (!keep) continue
    for (const row of rows.slice(1)) {
      if (row.source_id || row.run_id) {
        insertOccurrence.run(keep.id, row.source_id ?? '', row.run_id ?? '', row.created_at)
      }
      const occurrences = d.prepare(`
        SELECT source_id, run_id, observed_at FROM song_match_review_occurrences WHERE review_id = ?
      `).all(row.id) as Array<{ source_id: string; run_id: string; observed_at: string }>
      for (const occurrence of occurrences) {
        insertOccurrence.run(keep.id, occurrence.source_id, occurrence.run_id, occurrence.observed_at)
      }
      supersede.run(now, row.id)
    }
  }

  d.prepare(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_song_match_reviews_pending_candidate
    ON song_match_reviews(candidate_key)
    WHERE status = 'pending' AND candidate_key != ''
  `).run()
}

function ensureSongIdentityReviewSchema(d: Database.Database): void {
  d.transaction(() => repairSongIdentityReviewSchema(d))()
}

function ensureTaskRunSources(d: Database.Database): void {
  d.prepare(`
    CREATE TABLE IF NOT EXISTS task_run_sources (
      run_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL,
      PRIMARY KEY (run_id, source_id)
    )
  `).run()
  d.prepare('CREATE INDEX IF NOT EXISTS idx_task_run_sources_source ON task_run_sources(source_id, run_id)').run()

  const rows = d.prepare('SELECT id, data FROM task_runs').all() as Array<{ id: string; data: string }>
  const insert = d.prepare('INSERT OR IGNORE INTO task_run_sources (run_id, source_id) VALUES (?, ?)')
  const backfill = d.transaction(() => {
    for (const row of rows) {
      try {
        const payload = JSON.parse(row.data) as {
          sourceIds?: unknown
          songs?: Array<{ sourceId?: unknown }>
        }
        const sourceIds = new Set<string>()
        if (Array.isArray(payload.sourceIds)) {
          for (const sourceId of payload.sourceIds) {
            if (typeof sourceId === 'string' && sourceId) sourceIds.add(sourceId)
          }
        }
        for (const song of payload.songs || []) {
          if (typeof song.sourceId === 'string' && song.sourceId) sourceIds.add(song.sourceId)
        }
        for (const sourceId of sourceIds) insert.run(row.id, sourceId)
      } catch {
        // Malformed legacy payloads stay available; their source membership is unknown.
      }
    }
  })
  backfill()
}

function ensureDownloadTaskProcessingColumns(d: Database.Database): void {
  const columns = d.prepare("PRAGMA table_info('download_tasks')").all() as Array<{ name: string }>
  const hasColumn = (name: string) => columns.some(column => column.name === name)
  if (!hasColumn('idempotency_key')) d.prepare('ALTER TABLE download_tasks ADD COLUMN idempotency_key TEXT').run()
  if (!hasColumn('lease_owner')) d.prepare('ALTER TABLE download_tasks ADD COLUMN lease_owner TEXT').run()
  if (!hasColumn('lease_expires_at')) d.prepare('ALTER TABLE download_tasks ADD COLUMN lease_expires_at TEXT').run()
  if (!hasColumn('attempt_started_at')) d.prepare('ALTER TABLE download_tasks ADD COLUMN attempt_started_at TEXT').run()
  d.prepare(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_download_tasks_active_idempotency
    ON download_tasks(idempotency_key)
    WHERE idempotency_key IS NOT NULL AND status IN ('pending','downloading','tagging')
  `).run()
}

function ensureAuthTables(d: Database.Database): void {
  d.prepare(`
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `).run()
  d.prepare(`
    CREATE TABLE IF NOT EXISTS auth_admin (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      password_hash TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run()
  d.prepare(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      csrf_token TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      ip_address TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT ''
    )
  `).run()
  d.prepare('CREATE INDEX IF NOT EXISTS idx_auth_sessions_token ON auth_sessions(token_hash)').run()
  d.prepare('CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at)').run()
}

/** Safe to run on every boot; repairs the mixed v21 cache schema that some
 * installations kept after their user_version had already advanced. */
function repairArtistResolutionCache(d: Database.Database): void {
  if (!tableExists(d, 'artist_resolution_cache')) return
  const columns = d.prepare("PRAGMA table_info('artist_resolution_cache')").all() as Array<{ name: string; pk: number }>
  const has = (name: string) => columns.some(column => column.name === name)
  const normalizedIsPrimaryKey = columns.some(column => column.name === 'normalized_name' && column.pk === 1)
  if (has('original_name') && normalizedIsPrimaryKey) return

  d.exec(`
    DROP TABLE IF EXISTS artist_resolution_cache_repaired;
    CREATE TABLE artist_resolution_cache_repaired (
      normalized_name TEXT PRIMARY KEY, original_name TEXT NOT NULL, resolved_json TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'original', confidence INTEGER NOT NULL DEFAULT 0, mb_score INTEGER,
      last_status TEXT NOT NULL DEFAULT 'empty' CHECK(last_status IN ('success','empty','failed','disabled')),
      failure_count INTEGER NOT NULL DEFAULT 0, last_attempt_at TEXT, updated_at TEXT NOT NULL
    );
  `)
  const nameExpr = has('original_name') ? 'original_name' : has('artist_name') ? 'artist_name' : 'normalized_name'
  d.prepare(`
    INSERT OR REPLACE INTO artist_resolution_cache_repaired
      (normalized_name, original_name, resolved_json, source, confidence, mb_score, last_status, failure_count, last_attempt_at, updated_at)
    SELECT LOWER(REPLACE(${nameExpr}, ' ', '')), ${nameExpr}, resolved_json,
      COALESCE(source, 'original'), COALESCE(confidence, 0), mb_score,
      COALESCE(last_status, 'empty'), COALESCE(failure_count, 0), last_attempt_at, updated_at
    FROM artist_resolution_cache
  `).run()
  d.exec(`
    DROP TABLE artist_resolution_cache;
    ALTER TABLE artist_resolution_cache_repaired RENAME TO artist_resolution_cache;
    CREATE INDEX IF NOT EXISTS idx_artist_resolution_cache_updated ON artist_resolution_cache(updated_at);
  `)
}

export function migrateLegacyJobsToTaskRunsAndDrop(d: Database.Database): void {
  if (!tableExists(d, 'jobs')) return

  const columns = d.prepare("PRAGMA table_info('jobs')").all() as Array<{ name: string }>
  const hasColumn = (name: string) => columns.some(column => column.name === name)
  const typeExpr = hasColumn('type') ? "COALESCE(type, 'sync')" : "'sync'"
  const removedSongsExpr = hasColumn('removed_songs') ? 'COALESCE(removed_songs, 0)' : '0'

  d.prepare(`
    INSERT OR IGNORE INTO task_runs (
      id, type, trigger, started_at, finished_at, status, summary,
      total_items, success_items, failed_items, skipped_items, removed_items,
      warnings, source, target, duration_ms, data
    )
    SELECT id, ${typeExpr}, 'system', started_at, finished_at, status, summary,
      total_songs, success_songs, failed_songs, skipped_songs, ${removedSongsExpr},
      warnings, source, target, duration_ms, data
    FROM jobs
  `).run()
  ensureTaskRunSources(d)
  d.prepare('DROP TABLE IF EXISTS jobs').run()
}

const MIGRATIONS = createHistoricalMigrations({
  ensureAuthTables, ensureDownloadTaskProcessingColumns, ensureDownloadWhenMediaMissingOverride,
  ensureLocalMediaAssetOwnership, ensureMatchManagementSchema, ensureMusicBrainzIdMappingCache,
  ensureMusicBrainzRecordingCacheStatuses, ensureNullableSourceSyncOverrides,
  ensurePlaylistExtraObservationTable, ensurePlaylistSourceSyncCursorColumns,
  ensureSongIdentityBindingMethods, ensureSongIdentityReviewSchema, ensureTaskRunSources,
  migrateLegacyJobsToTaskRunsAndDrop, repairArtistResolutionCache,
  retireWeakMetadataBindingsAndLookupCache,
})

export function runMigrations(d: Database.Database): void {
  const currentVersion = (d.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
  for (let i = currentVersion; i < MIGRATIONS.length; i++) {
    const m = MIGRATIONS[i]
    if (!m) continue
    try {
      m(d)
    } catch (error) {
      if (!isIdempotentSchemaError(error)) throw error
    }
  }
  if (currentVersion < MIGRATIONS.length) {
    d.pragma(`user_version = ${MIGRATIONS.length}`)
  }
  ensureDownloadTaskProcessingColumns(d)
  ensureAuthTables(d)
  repairArtistResolutionCache(d)
  ensureSongIdentityReviewSchema(d)
  ensurePlaylistSourceSyncCursorColumns(d)
  ensureMusicBrainzRecordingCacheStatuses(d)
  ensurePlaylistExtraObservationTable(d)
  ensureMusicBrainzIdMappingCache(d)
  ensureSongIdentityBindingMethods(d)
  ensureMatchManagementSchema(d)
  ensureLocalMediaAssetOwnership(d)
  ensureNullableSourceSyncOverrides(d)
  ensureDownloadWhenMediaMissingOverride(d)
  retireWeakMetadataBindingsAndLookupCache(d)
}
