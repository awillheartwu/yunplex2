import type {
  JobStatus,
  SyncJob,
  SongTask,
  TaskRun,
  TaskRunFilter,
  TaskRunSummary,
  TaskRunTrigger,
  TaskRunType,
} from '../job/types'
import { getDb } from '../db'
import { dateEndBoundary, dateKeyInTimeZone, dateStartBoundary } from '../date-range'
import { reconcileRunFailures, recordFailure } from '../tasks/failure-records'
import { classifyDownloadFailure } from '../sync/download-diagnostics'

function normalizeRun(run: TaskRun): TaskRun {
  const sourceIds = new Set(run.sourceIds || [])
  for (const song of run.songs || []) {
    if (song.sourceId) sourceIds.add(song.sourceId)
  }
  return {
    ...run,
    trigger: run.trigger || (run.type === 'manual_download' ? 'user' : 'system'),
    sourceIds: [...sourceIds],
    steps: run.steps || [],
    songs: run.songs || [],
    config: run.config || {},
  }
}

export function saveRun(run: TaskRun): void {
  const normalized = normalizeRun(run)
  const db = getDb()
  const persist = db.transaction(() => {
    db.prepare(`
      INSERT OR REPLACE INTO task_runs (
        id, type, trigger, started_at, finished_at, status, summary,
        total_items, success_items, failed_items, skipped_items, removed_items,
        warnings, source, target, duration_ms, data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      normalized.id,
      normalized.type,
      normalized.trigger,
      normalized.startedAt,
      normalized.finishedAt,
      normalized.status,
      normalized.summary,
      normalized.totalSongs,
      normalized.successSongs,
      normalized.failedSongs,
      normalized.skippedSongs,
      normalized.removedSongs,
      normalized.warnings,
      normalized.source,
      normalized.target,
      normalized.durationMs,
      JSON.stringify(normalized),
    )
    db.prepare('DELETE FROM task_run_sources WHERE run_id = ?').run(normalized.id)
    const insertSource = db.prepare('INSERT INTO task_run_sources (run_id, source_id) VALUES (?, ?)')
    for (const sourceId of normalized.sourceIds || []) insertSource.run(normalized.id, sourceId)
  })
  persist()
}

export function saveSyncRun(job: SyncJob, trigger?: TaskRunTrigger): TaskRun {
  const existing = getRun(job.id)
  const run: TaskRun = {
    ...job,
    trigger: trigger || existing?.trigger || 'system',
  }
  saveRun(run)
  reconcileRunFailures(run)
  return run
}

export function getRun(id: string): TaskRun | null {
  const row = getDb().prepare('SELECT data, trigger, type FROM task_runs WHERE id = ?').get(id) as {
    data: string
    trigger: TaskRunTrigger
    type: TaskRunType
  } | undefined
  if (!row) return null
  const parsed = JSON.parse(row.data) as TaskRun
  return normalizeRun({ ...parsed, type: row.type, trigger: row.trigger })
}

export function getSyncRun(id: string): SyncJob | null {
  const run = getRun(id)
  return run && (run.type === 'sync' || run.type === 'repair') ? run as SyncJob : null
}

export function listRuns(filter: TaskRunFilter = {}): {
  items: TaskRunSummary[]
  total: number
  earliestDate: string | null
} {
  const conditions: string[] = []
  const params: unknown[] = []

  if (filter.type) {
    conditions.push('type = ?')
    params.push(filter.type)
  }
  if (filter.status) {
    conditions.push('status = ?')
    params.push(filter.status)
  }
  if (filter.sourceId) {
    conditions.push('EXISTS (SELECT 1 FROM task_run_sources trs WHERE trs.run_id = task_runs.id AND trs.source_id = ?)')
    params.push(filter.sourceId)
  }
  if (filter.search) {
    conditions.push(`(
      LOWER(summary) LIKE ?
      OR LOWER(id) LIKE ?
      OR LOWER(source) LIKE ?
      OR LOWER(target) LIKE ?
      OR EXISTS (
        SELECT 1
        FROM task_run_sources search_trs
        LEFT JOIN playlist_sources search_ps ON search_ps.id = search_trs.source_id
        WHERE search_trs.run_id = task_runs.id
          AND (
            LOWER(search_trs.source_id) LIKE ?
            OR LOWER(COALESCE(search_ps.name, '')) LIKE ?
            OR LOWER(COALESCE(search_ps.netease_playlist_name, '')) LIKE ?
          )
      )
      OR EXISTS (
        SELECT 1
        FROM json_each(task_runs.data, '$.songs') search_song
        WHERE LOWER(COALESCE(json_extract(search_song.value, '$.songName'), '')) LIKE ?
          OR LOWER(COALESCE(json_extract(search_song.value, '$.artist'), '')) LIKE ?
          OR LOWER(COALESCE(json_extract(search_song.value, '$.album'), '')) LIKE ?
      )
    )`)
    const query = `%${filter.search.trim().toLowerCase()}%`
    params.push(query, query, query, query, query, query, query, query, query, query)
  }
  if (filter.from) {
    const boundary = dateStartBoundary(filter.from, filter.timeZone)
    conditions.push('started_at >= ?')
    params.push(boundary.value)
  }
  if (filter.to) {
    const boundary = dateEndBoundary(filter.to, filter.timeZone)
    conditions.push(`started_at ${boundary.exclusive ? '<' : '<='} ?`)
    params.push(boundary.value)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = filter.limit ?? 50
  const offset = filter.offset ?? 0
  const db = getDb()
  const total = (db.prepare(`SELECT COUNT(*) AS count FROM task_runs ${where}`).get(...params) as { count: number }).count
  const rows = db.prepare(`
    SELECT id, type, trigger, started_at, finished_at, status, duration_ms,
      summary, source, total_items, success_items, failed_items, skipped_items,
      removed_items, warnings, data
    FROM task_runs
    ${where}
    ORDER BY started_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as Array<{
    id: string
    type: TaskRunType
    trigger: TaskRunTrigger
    started_at: string
    finished_at: string | null
    status: JobStatus
    duration_ms: number
    summary: string
    source: string
    total_items: number
    success_items: number
    failed_items: number
    skipped_items: number
    removed_items: number
    warnings: number
    data: string
  }>
  const earliest = db.prepare(`SELECT MIN(started_at) AS date FROM task_runs ${where}`).get(...params) as { date: string | null }

  return {
    items: rows.map(row => ({
      id: row.id,
      type: row.type,
      trigger: row.trigger,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      status: row.status,
      durationMs: row.duration_ms,
      summary: row.summary,
      source: row.source,
      totalSongs: row.total_items,
      successSongs: row.success_items,
      failedSongs: row.failed_items,
      skippedSongs: row.skipped_items,
      removedSongs: row.removed_items,
      warnings: row.warnings,
      dryRun: Boolean((JSON.parse(row.data) as Partial<TaskRun>).dryRun),
    })),
    total,
    earliestDate: earliest.date ? dateKeyInTimeZone(earliest.date, filter.timeZone) : null,
  }
}

export function createManualDownloadRun(input: {
  id: string
  total: number
  sourceLabel: string
  config?: TaskRun['config']
  songs?: SongTask[]
}): TaskRun {
  const startedAt = new Date().toISOString()
  const run: TaskRun = {
    id: input.id,
    type: 'manual_download',
    trigger: 'user',
    startedAt,
    finishedAt: null,
    status: 'running',
    durationMs: 0,
    summary: `手动下载 ${input.total} 首歌曲`,
    source: input.sourceLabel,
    target: '本地磁盘',
    totalSongs: input.total,
    successSongs: 0,
    failedSongs: 0,
    skippedSongs: 0,
    removedSongs: 0,
    warnings: 0,
    dryRun: false,
    steps: [{
      id: `${input.id}:download`,
      type: 'download',
      title: '下载并写入歌曲',
      status: 'running',
      startedAt,
      finishedAt: null,
      durationMs: 0,
      message: `正在处理 ${input.total} 首歌曲`,
      children: [],
    }],
    songs: input.songs || [],
    config: input.config || {},
  }
  saveRun(run)
  return run
}

export function syncManualDownloadRun(runId: string): TaskRun | null {
  const run = getRun(runId)
  if (!run || run.type !== 'manual_download') return run
  const rows = getDb().prepare(`
    SELECT id, source_id, song_id, song_name, artist, album, status, progress,
      file_path, file_type, quality, error, created_at, updated_at
    FROM download_tasks
    WHERE COALESCE(run_id, job_id) = ?
    ORDER BY created_at ASC
  `).all(runId) as Array<{
    id: string
    source_id: string | null
    song_id: number
    song_name: string
    artist: string
    album: string
    status: 'pending' | 'downloading' | 'tagging' | 'done' | 'failed'
    progress: number
    file_path: string | null
    file_type: string | null
    quality: string | null
    error: string | null
    created_at: string
    updated_at: string
  }>
  if (rows.length === 0) return run

  const active = rows.filter(row => ['pending', 'downloading', 'tagging'].includes(row.status)).length
  const success = rows.filter(row => row.status === 'done').length
  const failed = rows.filter(row => row.status === 'failed').length
  const finishedAt = active === 0 ? rows.reduce((latest, row) => row.updated_at > latest ? row.updated_at : latest, rows[0]!.updated_at) : null
  run.status = active > 0 ? 'running' : failed === 0 ? 'success' : success > 0 ? 'partial' : 'failed'
  run.finishedAt = finishedAt
  run.durationMs = Math.max(0, new Date(finishedAt || new Date().toISOString()).getTime() - new Date(run.startedAt).getTime())
  run.totalSongs = rows.length
  run.successSongs = success
  run.failedSongs = failed
  run.summary = `手动下载 ${rows.length} 首歌曲${failed > 0 ? `，${failed} 首失败` : ''}`
  run.songs = rows.map((row) => {
    const diagnosis = row.status === 'failed'
      ? classifyDownloadFailure(row.error, row.file_path)
      : null
    return {
      id: row.id,
      neteaseSongId: row.song_id,
      songName: row.song_name,
      artist: row.artist,
      album: row.album,
      status: row.status === 'done'
        ? 'success'
        : row.status === 'failed'
          ? diagnosis!.status
          : row.status === 'downloading' || row.status === 'tagging'
            ? 'downloading'
            : 'pending',
      phase: row.status === 'failed'
        ? diagnosis!.phase
        : row.status === 'tagging'
          ? 'tags'
          : row.status === 'done'
            ? 'done'
            : 'download',
      filePath: row.file_path || undefined,
      fileType: row.file_type || undefined,
      metadata: row.quality ? { quality: row.quality } : undefined,
      error: row.error ? {
        title: diagnosis?.title ?? '下载失败',
        message: row.error,
        stage: diagnosis?.phase ?? 'download',
        songName: row.song_name,
        artist: row.artist,
      } : undefined,
    }
  })
  const step = run.steps[0]
  if (step) {
    step.status = run.status === 'running' ? 'running' : run.status === 'success' ? 'success' : run.status
    step.finishedAt = finishedAt
    step.durationMs = run.durationMs
    step.message = `成功 ${success} 首${failed > 0 ? `，失败 ${failed} 首` : ''}`
  }
  saveRun(run)
  return run
}

export function recoverInterruptedRuns(): number {
  const now = new Date().toISOString()
  const interruptedDownloads = getDb().prepare(`
    SELECT id, source_id, song_id, song_name, artist, COALESCE(run_id, job_id) AS run_id, status
    FROM download_tasks
    WHERE status IN ('downloading','tagging')
  `).all() as Array<{
    id: string
    source_id: string | null
    song_id: number
    song_name: string
    artist: string
    run_id: string | null
    status: string
  }>
  if (interruptedDownloads.length > 0) {
    getDb().prepare(`
      UPDATE download_tasks
      SET status = 'failed',
        progress = 0,
        error = ?,
        lease_owner = NULL,
        lease_expires_at = NULL,
        updated_at = ?
      WHERE status IN ('downloading','tagging')
    `).run('任务因服务重启中断', now)
    for (const task of interruptedDownloads) {
      recordFailure({
        songId: task.song_id,
        songName: task.song_name,
        artist: task.artist,
        sourceId: task.source_id,
        runId: task.run_id,
        runType: task.source_id ? 'sync' : 'manual_download',
        failureKind: task.status === 'tagging' ? 'failed_tags' : 'failed_download',
        failureReason: '任务因服务重启中断',
        occurredAt: now,
        downloadTaskId: task.id,
      })
    }
  }

  const rows = getDb().prepare("SELECT id, data FROM task_runs WHERE status = 'running'").all() as Array<{ id: string; data: string }>
  let changed = interruptedDownloads.length
  for (const row of rows) {
    const run = JSON.parse(row.data) as TaskRun
    if (run.type === 'manual_download') {
      const synced = syncManualDownloadRun(run.id)
      if (synced?.status !== 'running') changed += 1
      continue
    }
    run.status = 'failed'
    run.finishedAt = now
    run.durationMs = Math.max(0, Date.now() - new Date(run.startedAt).getTime())
    run.summary = run.summary ? `${run.summary}（服务重启后中断）` : '任务因服务重启中断'
    for (const step of run.steps) {
      if (step.status === 'running' || step.status === 'pending') {
        step.status = 'cancelled'
        step.finishedAt = now
      }
    }
    saveRun(run)
    changed += 1
  }
  return changed
}
