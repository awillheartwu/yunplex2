import Database from 'better-sqlite3'

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

    CREATE TABLE IF NOT EXISTS sync_state (
      id               INTEGER PRIMARY KEY CHECK(id = 1),
      is_running       INTEGER NOT NULL DEFAULT 0,
      current_stage    TEXT,
      started_at       TEXT,
      last_sync_at     TEXT,
      last_sync_result TEXT,
      sync_count       INTEGER NOT NULL DEFAULT 0,
      success_count    INTEGER NOT NULL DEFAULT 0,
      failure_count    INTEGER NOT NULL DEFAULT 0,
      current_song     TEXT,
      progress_current INTEGER,
      progress_total   INTEGER,
      dry_run          INTEGER NOT NULL DEFAULT 0
    );

    INSERT OR IGNORE INTO sync_state (id) VALUES (1);

    CREATE TABLE IF NOT EXISTS task_runs (
      id             TEXT PRIMARY KEY,
      type           TEXT NOT NULL,
      trigger        TEXT NOT NULL DEFAULT 'system',
      started_at     TEXT NOT NULL,
      finished_at    TEXT,
      status         TEXT NOT NULL CHECK(status IN ('running','success','partial','failed','cancelled')),
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
      data           TEXT NOT NULL DEFAULT '{}'
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
      lease_owner     TEXT,
      lease_expires_at TEXT,
      attempt_started_at TEXT,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_download_tasks_status ON download_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_download_tasks_source ON download_tasks(source_id);
    CREATE INDEX IF NOT EXISTS idx_download_tasks_run ON download_tasks(run_id);

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
      copyright_restricted_ids TEXT,
      ignored_failure_ids     TEXT,
      requires_match_reconcile INTEGER NOT NULL DEFAULT 0,
      created_at              TEXT NOT NULL,
      updated_at              TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_playlist_sources_enabled ON playlist_sources(enabled);

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
      mb_recording_id TEXT,
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

  const downloadTaskColumns = db.prepare("PRAGMA table_info('download_tasks')").all() as Array<{ name: string }>
  if (downloadTaskColumns.some(column => column.name === 'idempotency_key')) {
    db.prepare(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_download_tasks_active_idempotency
      ON download_tasks(idempotency_key)
      WHERE idempotency_key IS NOT NULL AND status IN ('pending','downloading','tagging')
    `).run()
  }
}
