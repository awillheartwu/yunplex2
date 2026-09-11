import Database from 'better-sqlite3'
import { createFileTaskSchema } from './file-task-schema'
import { upgradeSourceRequests } from './source-request-upgrade'

export const CURRENT_SCHEMA_VERSION = 1

export function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_state (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_admin (
      id            INTEGER PRIMARY KEY CHECK(id = 1),
      password_hash TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id          TEXT PRIMARY KEY,
      token_hash  TEXT NOT NULL UNIQUE,
      csrf_token  TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      expires_at  TEXT NOT NULL,
      revoked_at  TEXT,
      ip_address  TEXT NOT NULL DEFAULT '',
      user_agent  TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_auth_sessions_token ON auth_sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at);

    CREATE TABLE IF NOT EXISTS logs (
      id        TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      level     TEXT NOT NULL CHECK(level IN ('info','warn','error','debug')),
      message   TEXT NOT NULL,
      detail    TEXT,
      stage     TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level);

    CREATE TABLE IF NOT EXISTS task_runs (
      id             TEXT PRIMARY KEY,
      type           TEXT NOT NULL,
      trigger        TEXT NOT NULL DEFAULT 'system',
      started_at     TEXT NOT NULL,
      finished_at    TEXT,
      status         TEXT NOT NULL CHECK(status IN ('running','awaiting_action','success','partial','failed','cancelled')),
      summary        TEXT NOT NULL DEFAULT '',
      total_items    INTEGER NOT NULL DEFAULT 0,
      success_items  INTEGER NOT NULL DEFAULT 0,
      failed_items   INTEGER NOT NULL DEFAULT 0,
      skipped_items  INTEGER NOT NULL DEFAULT 0,
      removed_items  INTEGER NOT NULL DEFAULT 0,
      warnings       INTEGER NOT NULL DEFAULT 0,
      source         TEXT NOT NULL DEFAULT '',
      target         TEXT NOT NULL DEFAULT '',
      duration_ms    INTEGER NOT NULL DEFAULT 0,
      dry_run        INTEGER NOT NULL DEFAULT 0,
      details_expired INTEGER NOT NULL DEFAULT 0,
      steps_json     TEXT NOT NULL DEFAULT '[]'
    );

    CREATE INDEX IF NOT EXISTS idx_task_runs_started ON task_runs(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_task_runs_status ON task_runs(status);
    CREATE INDEX IF NOT EXISTS idx_task_runs_type ON task_runs(type);

    CREATE TABLE IF NOT EXISTS task_run_sources (
      run_id    TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL,
      PRIMARY KEY (run_id, source_id)
    );

    CREATE INDEX IF NOT EXISTS idx_task_run_sources_source ON task_run_sources(source_id, run_id);

    CREATE TABLE IF NOT EXISTS task_run_song_changes (
      run_id          TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
      item_id         TEXT NOT NULL,
      source_id       TEXT,
      netease_song_id INTEGER,
      netease_index   INTEGER,
      song_name       TEXT NOT NULL,
      artist          TEXT NOT NULL DEFAULT '',
      album           TEXT NOT NULL DEFAULT '',
      status          TEXT NOT NULL,
      phase           TEXT NOT NULL,
      file_path       TEXT,
      file_type       TEXT,
      error_json      TEXT,
      metadata_json   TEXT,
      ops_json        TEXT,
      PRIMARY KEY (run_id, item_id)
    );

    CREATE INDEX IF NOT EXISTS idx_task_run_song_changes_status
      ON task_run_song_changes(run_id, status);
    CREATE INDEX IF NOT EXISTS idx_task_run_song_changes_source
      ON task_run_song_changes(source_id, run_id);
    CREATE INDEX IF NOT EXISTS idx_task_run_song_changes_song
      ON task_run_song_changes(netease_song_id, run_id);

    CREATE TABLE IF NOT EXISTS download_tasks (
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
      run_id          TEXT,
      idempotency_key TEXT,
      operation       TEXT NOT NULL DEFAULT 'download'
        CHECK(operation IN ('download','replace','managed_copy','repair_existing')),
      target_path     TEXT,
      execution_intent_json TEXT,
      lease_owner     TEXT,
      lease_expires_at TEXT,
      attempt_started_at TEXT,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_download_tasks_status ON download_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_download_tasks_source ON download_tasks(source_id);
    CREATE INDEX IF NOT EXISTS idx_download_tasks_run ON download_tasks(run_id);
    CREATE INDEX IF NOT EXISTS idx_download_tasks_time ON download_tasks(updated_at DESC);

    CREATE TABLE IF NOT EXISTS playlist_sources (
      id                      TEXT PRIMARY KEY,
      netease_playlist_id     INTEGER NOT NULL UNIQUE,
      name                    TEXT NOT NULL DEFAULT '',
      enabled                 INTEGER NOT NULL DEFAULT 1,
      plex_playlist_name      TEXT NOT NULL DEFAULT '',
      plex_playlist_rating_key TEXT NOT NULL DEFAULT '',
      sync_limit              INTEGER,
      last_synced_at          TEXT,
      last_status             TEXT NOT NULL DEFAULT 'idle',
      last_error              TEXT,
      last_job_id             TEXT,
      auto_create_plex_playlist INTEGER NOT NULL DEFAULT 0,
      track_count              INTEGER NOT NULL DEFAULT 0,
      last_track_update_time  INTEGER,
      force_full_compare      INTEGER,
      download_when_media_missing INTEGER,
      consecutive_skips       INTEGER NOT NULL DEFAULT 0,
      full_compare_after_skips INTEGER,
      full_compare_after_days  INTEGER,
      last_full_compare_at    TEXT,
      plex_updated_at         INTEGER,
      track_id_snapshot       TEXT,
      last_observed_plex_fingerprint TEXT,
      last_applied_plex_fingerprint TEXT,
      last_observed_netease_cursor TEXT,
      last_compared_netease_cursor TEXT,
      last_observed_at        TEXT,
      last_compared_at        TEXT,
      netease_playlist_name   TEXT NOT NULL DEFAULT '',
      sort_order              INTEGER NOT NULL DEFAULT 0,
      type                    TEXT NOT NULL DEFAULT 'playlist',
      subscribed              INTEGER NOT NULL DEFAULT 0,
      cover_url               TEXT NOT NULL DEFAULT '',
      skip_plex_playlist      INTEGER,
      skip_remove_extra_tracks INTEGER,
      requires_match_reconcile INTEGER NOT NULL DEFAULT 0,
      sync_interval_minutes   INTEGER CHECK(sync_interval_minutes IS NULL OR sync_interval_minutes BETWEEN 1 AND 1440),
      initialize_media_on_first_sync INTEGER CHECK(initialize_media_on_first_sync IS NULL OR initialize_media_on_first_sync IN (0, 1)),
      next_sync_at            TEXT,
      last_schedule_status    TEXT NOT NULL DEFAULT 'idle'
        CHECK(last_schedule_status IN ('idle','queued','running','success','partial','failed')),
      last_scheduled_at       TEXT,
      last_schedule_error     TEXT,
      created_at              TEXT NOT NULL,
      updated_at              TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_playlist_sources_enabled ON playlist_sources(enabled);
    CREATE INDEX IF NOT EXISTS idx_playlist_sources_next_sync ON playlist_sources(enabled, next_sync_at);

    CREATE TABLE IF NOT EXISTS source_sync_queue (
      id              TEXT PRIMARY KEY,
      source_id       TEXT NOT NULL REFERENCES playlist_sources(id) ON DELETE CASCADE,
      schedule_window TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','running','completed','failed','cancelled')),
      available_at    TEXT NOT NULL,
      lease_owner     TEXT,
      lease_expires_at TEXT,
      attempts        INTEGER NOT NULL DEFAULT 0,
      run_id          TEXT,
      last_error      TEXT,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL,
      started_at      TEXT,
      finished_at     TEXT,
      UNIQUE(source_id, schedule_window)
    );
    CREATE INDEX IF NOT EXISTS idx_source_sync_queue_pending
      ON source_sync_queue(status, available_at, created_at);
    CREATE INDEX IF NOT EXISTS idx_source_sync_queue_source
      ON source_sync_queue(source_id, status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_source_sync_queue_single_running
      ON source_sync_queue((1)) WHERE status = 'running';

    CREATE TABLE IF NOT EXISTS source_initializations (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES playlist_sources(id) ON DELETE CASCADE,
      run_id TEXT,
      follow_up_run_id TEXT,
      trigger TEXT NOT NULL DEFAULT 'system',
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','analyzing','awaiting_review','applying','completed','failed','cancelled','skipped')),
      netease_cursor TEXT,
      plex_fingerprint TEXT,
      total_items INTEGER NOT NULL DEFAULT 0,
      preserved_items INTEGER NOT NULL DEFAULT 0,
      strong_items INTEGER NOT NULL DEFAULT 0,
      high_confidence_items INTEGER NOT NULL DEFAULT 0,
      possible_items INTEGER NOT NULL DEFAULT 0,
      ambiguous_items INTEGER NOT NULL DEFAULT 0,
      unmatched_items INTEGER NOT NULL DEFAULT 0,
      adopt_items INTEGER NOT NULL DEFAULT 0,
      download_items INTEGER NOT NULL DEFAULT 0,
      deferred_items INTEGER NOT NULL DEFAULT 0,
      conflict_items INTEGER NOT NULL DEFAULT 0,
      summary TEXT NOT NULL DEFAULT '',
      error TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      analyzed_at TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_source_initializations_source
      ON source_initializations(source_id, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_source_initializations_active
      ON source_initializations(source_id)
      WHERE status IN ('pending','analyzing','awaiting_review','applying');

    CREATE TABLE IF NOT EXISTS source_initialization_items (
      initialization_id TEXT NOT NULL REFERENCES source_initializations(id) ON DELETE CASCADE,
      netease_song_id INTEGER NOT NULL,
      position INTEGER NOT NULL,
      occurrence_count INTEGER NOT NULL DEFAULT 1,
      title TEXT NOT NULL DEFAULT '',
      artists_json TEXT NOT NULL DEFAULT '[]',
      album TEXT NOT NULL DEFAULT '',
      track_number INTEGER,
      duration_ms INTEGER,
      tier TEXT NOT NULL CHECK(tier IN ('preserved','strong_id','high_confidence','possible','ambiguous','unmatched','metadata_missing','conflict')),
      candidate_rating_key TEXT,
      candidate_file_path TEXT,
      candidate_title TEXT NOT NULL DEFAULT '',
      candidate_artist TEXT NOT NULL DEFAULT '',
      candidate_album TEXT NOT NULL DEFAULT '',
      candidate_duration_ms INTEGER,
      candidate_count INTEGER NOT NULL DEFAULT 0,
      candidates_json TEXT NOT NULL DEFAULT '[]',
      evidence_json TEXT NOT NULL DEFAULT '{}',
      expected_binding_updated_at TEXT,
      decision TEXT NOT NULL DEFAULT 'defer' CHECK(decision IN ('adopt','download','defer')),
      decision_status TEXT NOT NULL DEFAULT 'proposed' CHECK(decision_status IN ('proposed','applied','deferred','conflict','failed')),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (initialization_id, netease_song_id)
    );
    CREATE INDEX IF NOT EXISTS idx_source_initialization_items_filter
      ON source_initialization_items(initialization_id, tier, decision, position);

    CREATE TABLE IF NOT EXISTS source_media_decisions (
      source_id TEXT NOT NULL REFERENCES playlist_sources(id) ON DELETE CASCADE,
      netease_song_id INTEGER NOT NULL,
      disposition TEXT NOT NULL CHECK(disposition IN ('defer','download')),
      initialization_id TEXT NOT NULL REFERENCES source_initializations(id) ON DELETE CASCADE,
      resolved_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (source_id, netease_song_id)
    );
    CREATE INDEX IF NOT EXISTS idx_source_media_decisions_active
      ON source_media_decisions(source_id, disposition, resolved_at);

    CREATE TABLE IF NOT EXISTS task_run_links (
      run_id TEXT PRIMARY KEY REFERENCES task_runs(id) ON DELETE CASCADE,
      related_run_id TEXT NOT NULL,
      relation TEXT NOT NULL CHECK(relation IN ('initialization_follow_up','follow_up_of'))
    );

    -- Durable provenance for files written or adopted by YunPlex. Unlike the
    -- download queue this table is not retention-pruned, so path identity can
    -- be recovered after old task history is cleaned up.
    CREATE TABLE IF NOT EXISTS local_media_assets (
      netease_song_id INTEGER PRIMARY KEY,
      file_path TEXT NOT NULL,
      provenance TEXT NOT NULL CHECK(provenance IN ('download_task','legacy_download_task','computed','manual')),
      ownership TEXT NOT NULL DEFAULT 'external' CHECK(ownership IN ('managed','external')),
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

    CREATE TABLE IF NOT EXISTS song_identity_bindings (
      netease_song_id INTEGER PRIMARY KEY,
      plex_section_key TEXT NOT NULL DEFAULT '',
      plex_file_path TEXT NOT NULL,
      plex_relative_path TEXT NOT NULL DEFAULT '',
      plex_rating_key TEXT,
      binding_method TEXT NOT NULL CHECK(binding_method IN ('path','manual')),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','stale','unbound')),
      evidence_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_verified_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_song_identity_bindings_path ON song_identity_bindings(plex_file_path);
    CREATE INDEX IF NOT EXISTS idx_song_identity_bindings_rating_key ON song_identity_bindings(plex_rating_key);

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

    CREATE TABLE IF NOT EXISTS failure_records (
      id                TEXT PRIMARY KEY,
      fingerprint       TEXT NOT NULL UNIQUE,
      subject_key       TEXT NOT NULL,
      song_id           INTEGER,
      song_name         TEXT NOT NULL,
      artist            TEXT NOT NULL DEFAULT '',
      source_id         TEXT,
      source_name       TEXT NOT NULL DEFAULT '',
      run_id            TEXT,
      run_type          TEXT NOT NULL,
      failure_kind      TEXT NOT NULL,
      failure_reason    TEXT NOT NULL DEFAULT '',
      status            TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','ignored','resolved')),
      first_seen_at     TEXT NOT NULL,
      last_seen_at      TEXT NOT NULL,
      ignored_at        TEXT,
      resolved_at       TEXT,
      occurrence_count  INTEGER NOT NULL DEFAULT 1,
      retry_count       INTEGER NOT NULL DEFAULT 0,
      download_task_ids TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_failure_records_status ON failure_records(status, last_seen_at DESC);
    CREATE INDEX IF NOT EXISTS idx_failure_records_run ON failure_records(run_id);
    CREATE INDEX IF NOT EXISTS idx_failure_records_subject ON failure_records(subject_key);

    CREATE TABLE IF NOT EXISTS failure_occurrences (
      fingerprint    TEXT NOT NULL,
      occurrence_key TEXT NOT NULL,
      occurred_at    TEXT NOT NULL,
      PRIMARY KEY (fingerprint, occurrence_key)
    );

    CREATE INDEX IF NOT EXISTS idx_failure_occurrences_fingerprint ON failure_occurrences(fingerprint);

  `)

  createFileTaskSchema(db)
  upgradeSourceRequests(db)
  const downloadTaskColumns = db.prepare("PRAGMA table_info('download_tasks')").all() as Array<{ name: string }>
  if (!downloadTaskColumns.some(column => column.name === 'operation')) {
    db.prepare("ALTER TABLE download_tasks ADD COLUMN operation TEXT NOT NULL DEFAULT 'download'").run()
  }
  if (!downloadTaskColumns.some(column => column.name === 'target_path')) {
    db.prepare('ALTER TABLE download_tasks ADD COLUMN target_path TEXT').run()
  }
  if (!downloadTaskColumns.some(column => column.name === 'execution_intent_json')) {
    db.prepare('ALTER TABLE download_tasks ADD COLUMN execution_intent_json TEXT').run()
  }
  if (downloadTaskColumns.some(column => column.name === 'idempotency_key')) {
    db.prepare(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_download_tasks_active_idempotency
      ON download_tasks(idempotency_key)
      WHERE idempotency_key IS NOT NULL AND status IN ('pending','downloading','tagging')
    `).run()
  }

  const sourceColumns = db.prepare("PRAGMA table_info('playlist_sources')").all() as Array<{ name: string }>
  if (!sourceColumns.some(column => column.name === 'initialize_media_on_first_sync')) {
    db.prepare('ALTER TABLE playlist_sources ADD COLUMN initialize_media_on_first_sync INTEGER').run()
  }

  // Preserved items already have an active identity binding. Older review
  // drafts could incorrectly make them actionable and include them in the
  // adopt/download/defer totals even though commit intentionally skips them.
  db.prepare(`
    UPDATE source_initialization_items
    SET decision = 'defer', decision_status = 'proposed'
    WHERE tier = 'preserved' AND (decision != 'defer' OR decision_status != 'proposed')
  `).run()
  db.prepare(`
    UPDATE source_initializations
    SET adopt_items = (
          SELECT COUNT(*) FROM source_initialization_items item
          WHERE item.initialization_id = source_initializations.id AND item.tier != 'preserved' AND item.decision = 'adopt'
        ),
        download_items = (
          SELECT COUNT(*) FROM source_initialization_items item
          WHERE item.initialization_id = source_initializations.id AND item.tier != 'preserved' AND item.decision = 'download'
        ),
        deferred_items = (
          SELECT COUNT(*) FROM source_initialization_items item
          WHERE item.initialization_id = source_initializations.id AND item.tier != 'preserved' AND item.decision = 'defer'
        )
    WHERE status IN ('pending','analyzing','awaiting_review')
  `).run()

  const now = new Date().toISOString()
  db.prepare(`
    UPDATE task_runs
    SET status = 'failed', finished_at = ?, summary = '首次媒体接管分析因服务中断，等待重试'
    WHERE status = 'running' AND type = 'source_initialization'
      AND id IN (SELECT run_id FROM source_initializations WHERE status = 'analyzing')
      AND NOT EXISTS (SELECT 1 FROM source_sync_queue q WHERE q.run_id=task_runs.id AND q.status IN ('pending','running'))
  `).run(now)
  db.prepare(`
    UPDATE source_initializations
    SET status = 'pending', error = '上次分析因服务中断，请重新开始', updated_at = ?
    WHERE status = 'analyzing'
  `).run(now)
  db.prepare(`
    UPDATE source_initializations
    SET status = 'awaiting_review', error = '上次应用因服务中断，请刷新并重新提交', updated_at = ?
    WHERE status = 'applying'
  `).run(now)
  db.prepare(`
    INSERT OR IGNORE INTO source_initializations (id, source_id, status, created_at, updated_at)
    SELECT lower(hex(randomblob(16))), source.id, 'pending', ?, ?
    FROM playlist_sources source
    WHERE source.type = 'playlist'
      AND NOT EXISTS (
        SELECT 1 FROM source_initializations initialization
        WHERE initialization.source_id = source.id
      )
  `).run(now, now)

  db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`)
}
