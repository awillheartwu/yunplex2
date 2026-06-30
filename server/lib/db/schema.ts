import Database from 'better-sqlite3'

export function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

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
      force_full_compare      INTEGER NOT NULL DEFAULT 0,
      consecutive_skips       INTEGER NOT NULL DEFAULT 0,
      full_compare_after_skips INTEGER,
      full_compare_after_days  INTEGER,
      last_full_compare_at    TEXT,
      plex_updated_at         INTEGER,
      track_id_snapshot       TEXT,
      netease_playlist_name   TEXT NOT NULL DEFAULT '',
      sort_order              INTEGER NOT NULL DEFAULT 0,
      type                    TEXT NOT NULL DEFAULT 'playlist',
      subscribed              INTEGER NOT NULL DEFAULT 0,
      cover_url               TEXT NOT NULL DEFAULT '',
      skip_plex_playlist      INTEGER NOT NULL DEFAULT 0,
      copyright_restricted_ids TEXT,
      ignored_failure_ids     TEXT,
      created_at              TEXT NOT NULL,
      updated_at              TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_playlist_sources_enabled ON playlist_sources(enabled);

    CREATE TABLE IF NOT EXISTS song_lookup (
      netease_song_id   INTEGER PRIMARY KEY,
      plex_rating_key   TEXT,
      file_path         TEXT,
      last_verified_at  TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_song_lookup_rating_key ON song_lookup(plex_rating_key);

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
    );

    CREATE INDEX IF NOT EXISTS idx_activity_events_occurred_at ON activity_events(occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_activity_events_domain ON activity_events(domain);
    CREATE INDEX IF NOT EXISTS idx_activity_events_severity ON activity_events(severity);
    CREATE INDEX IF NOT EXISTS idx_activity_events_group_key ON activity_events(group_key);

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
}
