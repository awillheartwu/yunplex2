import type {
  JobStatus,
  JobStep,
  SyncJob,
  SongStatus,
  SongTask,
  TaskRun,
  TaskRunFilter,
  TaskRunSummary,
  TaskRunTrigger,
  TaskRunType,
} from '../job/types'
import { getDb } from '../db'
import { createFileTaskSchema } from '../db/file-task-schema'
import { dateEndBoundary, dateKeyInTimeZone, dateStartBoundary } from '../date-range'
import { reconcileRunFailures } from '../tasks/failure-records'
import { classifyDownloadFailure } from '../sync/download-diagnostics'
import { projectTaskRunDynamicFields, projectTaskRunStatus, taskRunStatusFilterSql, taskRunsSupportsAwaitingAction } from './status-projection'

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

const UNCHANGED_SONG_STATUSES = new Set<SongStatus>(['pending', 'skipped_existing'])

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function changedSongs(run: TaskRun): SongTask[] {
  return run.status === 'running'
    ? []
    : run.songs.filter(song => !UNCHANGED_SONG_STATUSES.has(song.status))
}

export function saveRun(run: TaskRun): void {
  const normalized = normalizeRun(run)
  const persistedSongs = changedSongs(normalized)
  const db = getDb()
  const persist = db.transaction(() => {
    db.prepare(`
      INSERT INTO task_runs (
        id, type, trigger, started_at, finished_at, status, summary,
        total_items, success_items, failed_items, skipped_items, removed_items,
        warnings, source, target, duration_ms, dry_run, details_expired, steps_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        type = excluded.type,
        trigger = excluded.trigger,
        started_at = excluded.started_at,
        finished_at = excluded.finished_at,
        status = excluded.status,
        summary = excluded.summary,
        total_items = excluded.total_items,
        success_items = excluded.success_items,
        failed_items = excluded.failed_items,
        skipped_items = excluded.skipped_items,
        removed_items = excluded.removed_items,
        warnings = excluded.warnings,
        source = excluded.source,
        target = excluded.target,
        duration_ms = excluded.duration_ms,
        dry_run = excluded.dry_run,
        details_expired = excluded.details_expired,
        steps_json = excluded.steps_json
    `).run(
      normalized.id,
      normalized.type,
      normalized.trigger,
      normalized.startedAt,
      normalized.finishedAt,
      normalized.status === 'awaiting_action' && !taskRunsSupportsAwaitingAction(db) ? 'partial' : normalized.status,
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
      normalized.dryRun ? 1 : 0,
      normalized.detailsExpired ? 1 : 0,
      normalized.status === 'running' ? '[]' : JSON.stringify(normalized.steps),
    )
    const insertSource = db.prepare('INSERT OR IGNORE INTO task_run_sources (run_id, source_id) VALUES (?, ?)')
    for (const sourceId of normalized.sourceIds || []) insertSource.run(normalized.id, sourceId)

    if (normalized.status !== 'running') {
      db.prepare('DELETE FROM task_run_song_changes WHERE run_id = ?').run(normalized.id)
      const insertSong = db.prepare(`
        INSERT INTO task_run_song_changes (
          run_id, item_id, source_id, netease_song_id, netease_index,
          song_name, artist, album, status, phase, file_path, file_type,
          error_json, metadata_json, ops_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const song of persistedSongs) {
        insertSong.run(
          normalized.id,
          song.id,
          song.sourceId ?? null,
          song.neteaseSongId ?? null,
          song.neteaseIndex ?? null,
          song.songName,
          song.artist,
          song.album,
          song.status,
          song.phase,
          song.filePath ?? null,
          song.fileType ?? null,
          song.error ? JSON.stringify(song.error) : null,
          song.metadata ? JSON.stringify(song.metadata) : null,
          song.ops ? JSON.stringify(song.ops) : null,
        )
      }
    }
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
  if (run.status !== 'running') reconcileRunFailures(run)
  return run
}

export function getRun(id: string): TaskRun | null {
  const db = getDb()
  const row = db.prepare(`
    SELECT id, type, trigger, started_at, finished_at, status, duration_ms,
      summary, source, target, total_items, success_items, failed_items,
      skipped_items, removed_items, warnings, dry_run, details_expired, steps_json
    FROM task_runs
    WHERE id = ?
  `).get(id) as {
    id: string
    trigger: TaskRunTrigger
    type: TaskRunType
    started_at: string
    finished_at: string | null
    status: JobStatus
    duration_ms: number
    summary: string
    source: string
    target: string
    total_items: number
    success_items: number
    failed_items: number
    skipped_items: number
    removed_items: number
    warnings: number
    dry_run: number
    details_expired: number
    steps_json: string
  } | undefined
  if (!row) return null
  const dynamicFields = projectTaskRunDynamicFields(db, row)
  const sourceIds = (db.prepare('SELECT source_id FROM task_run_sources WHERE run_id = ? ORDER BY source_id').all(id) as Array<{ source_id: string }>)
    .map(item => item.source_id)
  const songs = (db.prepare(`
    SELECT item_id, source_id, netease_song_id, netease_index, song_name,
      artist, album, status, phase, file_path, file_type, error_json,
      metadata_json, ops_json
    FROM task_run_song_changes
    WHERE run_id = ?
    ORDER BY COALESCE(netease_index, 2147483647), rowid
  `).all(id) as Array<{
    item_id: string
    source_id: string | null
    netease_song_id: number | null
    netease_index: number | null
    song_name: string
    artist: string
    album: string
    status: SongStatus
    phase: SongTask['phase']
    file_path: string | null
    file_type: string | null
    error_json: string | null
    metadata_json: string | null
    ops_json: string | null
  }>).map(song => ({
    id: song.item_id,
    sourceId: song.source_id ?? undefined,
    neteaseSongId: song.netease_song_id ?? undefined,
    neteaseIndex: song.netease_index ?? undefined,
    songName: song.song_name,
    artist: song.artist,
    album: song.album,
    status: song.status,
    phase: song.phase,
    filePath: song.file_path ?? undefined,
    fileType: song.file_type ?? undefined,
    error: parseJson(song.error_json, undefined),
    metadata: parseJson(song.metadata_json, undefined),
    ops: parseJson(song.ops_json, undefined),
  }))
  return normalizeRun({
    id: row.id,
    type: row.type,
    trigger: row.trigger,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: projectTaskRunStatus(db, row),
    ...dynamicFields,
    durationMs: row.duration_ms,
    summary: row.summary,
    source: row.source,
    sourceIds,
    target: row.target,
    totalSongs: row.total_items,
    successSongs: row.success_items,
    failedSongs: row.failed_items,
    skippedSongs: row.skipped_items,
    removedSongs: row.removed_items,
    warnings: row.warnings,
    dryRun: Boolean(row.dry_run),
    detailsExpired: Boolean(row.details_expired),
    steps: parseJson<JobStep[]>(row.steps_json, []),
    songs,
    config: {},
  })
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
    const statusFilter = taskRunStatusFilterSql(filter.status)
    conditions.push(statusFilter.sql)
    params.push(...statusFilter.params)
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
        FROM task_run_song_changes search_song
        WHERE search_song.run_id = task_runs.id
          AND (
            LOWER(search_song.song_name) LIKE ?
            OR LOWER(search_song.artist) LIKE ?
            OR LOWER(search_song.album) LIKE ?
          )
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
      removed_items, warnings, dry_run
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
    dry_run: number
  }>
  const earliest = db.prepare(`SELECT MIN(started_at) AS date FROM task_runs ${where}`).get(...params) as { date: string | null }

  return {
    items: rows.map(row => ({
      id: row.id,
      type: row.type,
      trigger: row.trigger,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      status: projectTaskRunStatus(db, row),
      ...projectTaskRunDynamicFields(db, row),
      durationMs: row.duration_ms,
      summary: row.summary,
      source: row.source,
      totalSongs: row.total_items,
      successSongs: row.success_items,
      failedSongs: row.failed_items,
      skippedSongs: row.skipped_items,
      removedSongs: row.removed_items,
      warnings: row.warnings,
      dryRun: Boolean(row.dry_run),
    })),
    total,
    earliestDate: earliest.date ? dateKeyInTimeZone(earliest.date, filter.timeZone) : null,
  }
}

export function createManualDownloadRun(input: {
  id: string
  total: number
  sourceLabel: string
  sourceIds?: string[]
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
    sourceIds: input.sourceIds,
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

export function createRepairRun(input: {
  id: string
  total: number
  skipped: number
  sourceId: string
  sourceLabel: string
}): TaskRun {
  const startedAt = new Date().toISOString()
  const run: TaskRun = {
    id: input.id,
    type: 'repair',
    trigger: 'user',
    startedAt,
    finishedAt: null,
    status: 'running',
    durationMs: 0,
    summary: `补全资源：${input.sourceLabel}`,
    source: input.sourceLabel,
    sourceIds: [input.sourceId],
    target: '本地媒体标签与辅助文件',
    totalSongs: input.total,
    successSongs: 0,
    failedSongs: 0,
    skippedSongs: input.skipped,
    removedSongs: 0,
    warnings: 0,
    dryRun: false,
    steps: [{
      id: `${input.id}:repair`,
      type: 'repair',
      title: '补全本地标签与辅助文件',
      status: 'running',
      startedAt,
      finishedAt: null,
      durationMs: 0,
      message: `正在处理 ${input.total - input.skipped} 首歌曲`,
      children: [],
    }],
    songs: [],
    config: {},
  }
  saveRun(run)
  return run
}

export function syncRepairRun(runId: string, options: { finalize?: boolean } = {}): TaskRun | null {
  const finalize = options.finalize ?? true
  const run = getRun(runId)
  if (!run || run.type !== 'repair') return run
  const db = getDb()
  createFileTaskSchema(db)
  const linkedRows = db.prepare(`
    SELECT task.status, task.updated_at
    FROM run_file_tasks linked
    JOIN download_tasks task ON task.id = linked.task_id
    WHERE linked.run_id = ?
      AND task.operation = 'repair_existing'
    ORDER BY linked.created_at ASC, task.created_at ASC
  `).all(runId) as Array<{
    status: 'pending' | 'downloading' | 'tagging' | 'done' | 'failed'
    updated_at: string
  }>
  // Keep pre-association repair runs recoverable after upgrading an existing
  // database. New submissions always use run_file_tasks above.
  const rows = linkedRows.length > 0 ? linkedRows : db.prepare(`
    SELECT status, updated_at
    FROM download_tasks
    WHERE COALESCE(run_id, job_id) = ?
      AND operation = 'repair_existing'
    ORDER BY created_at ASC
  `).all(runId) as Array<{
    status: 'pending' | 'downloading' | 'tagging' | 'done' | 'failed'
    updated_at: string
  }>
  const queued = rows.length
  const skipped = Math.max(0, run.totalSongs - queued)
  const active = rows.filter(row => ['pending', 'downloading', 'tagging'].includes(row.status)).length
  const success = rows.filter(row => row.status === 'done').length
  const failed = rows.filter(row => row.status === 'failed').length
  const finishedAt = active === 0
    ? rows.reduce((latest, row) => row.updated_at > latest ? row.updated_at : latest, run.startedAt)
    : null

  run.status = !finalize || active > 0
    ? 'running'
    : failed === 0
      ? 'success'
      : success > 0
        ? 'partial'
        : 'failed'
  run.finishedAt = finalize ? finishedAt : null
  run.durationMs = Math.max(
    0,
    new Date(run.finishedAt || new Date().toISOString()).getTime() - new Date(run.startedAt).getTime(),
  )
  run.successSongs = success
  run.failedSongs = failed
  run.skippedSongs = skipped
  const progressSummary = `成功 ${success} 首${failed > 0 ? `，失败 ${failed} 首` : ''}${skipped > 0 ? `，跳过 ${skipped} 首` : ''}`
  run.summary = !finalize && active === 0
    ? `补全资源文件处理完成：${progressSummary}，等待 Plex 刷新`
    : active > 0
    ? `补全资源进行中：${progressSummary}，待处理 ${active} 首`
    : `补全资源完成：${progressSummary}`

  const step = run.steps[0]
  if (step) {
    step.status = !finalize || run.status === 'running' ? 'running' : run.status
    step.finishedAt = finalize ? finishedAt : null
    step.durationMs = run.durationMs
    step.message = !finalize && active === 0
      ? `${progressSummary}，等待 Plex 刷新`
      : active > 0 ? `${progressSummary}，待处理 ${active} 首` : progressSummary
  }
  saveRun(run)
  return run
}

export function syncManualDownloadRun(runId: string): TaskRun | null {
  const run = getRun(runId)
  if (!run || run.type !== 'manual_download') return run
  const db = getDb()
  createFileTaskSchema(db)
  const linkedRows = db.prepare(`
    SELECT task.id, linked.source_id AS source_id,
      task.song_id, task.song_name, task.artist, task.album, task.status, task.progress,
      task.file_path, task.file_type, task.quality, task.error, task.created_at, task.updated_at
    FROM run_file_tasks linked
    JOIN download_tasks task ON task.id = linked.task_id
    WHERE linked.run_id = ?
    ORDER BY linked.created_at ASC, task.created_at ASC
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
  const rows = linkedRows.length > 0 ? linkedRows : db.prepare(`
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
      sourceId: row.source_id ?? undefined,
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
  const step: JobStep = run.steps[0] || {
    id: `${run.id}:download`,
    type: 'download',
    title: '下载并写入歌曲',
    status: 'running',
    startedAt: run.startedAt,
    finishedAt: null,
    durationMs: 0,
    message: '',
    children: [],
  }
  if (run.steps.length === 0) run.steps.push(step)
  step.status = run.status === 'running' ? 'running' : run.status === 'success' ? 'success' : run.status
  step.finishedAt = finishedAt
  step.durationMs = run.durationMs
  step.message = `成功 ${success} 首${failed > 0 ? `，失败 ${failed} 首` : ''}`
  saveRun(run)
  return run
}

export function recoverInterruptedRuns(): number {
  const now = new Date().toISOString()
  const interruptedDownloads = getDb().prepare(`
    SELECT id, source_id, song_id, song_name, artist,
      COALESCE(run_id, job_id) AS run_id, status, operation
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
    operation: string
  }>
  if (interruptedDownloads.length > 0) {
    getDb().prepare(`
      UPDATE download_tasks
      SET status = 'pending',
        progress = 0,
        error = NULL,
        lease_owner = NULL,
        lease_expires_at = NULL,
        attempt_started_at = NULL,
        updated_at = ?
      WHERE status IN ('downloading','tagging')
    `).run(now)
  }

  const db = getDb()
  createFileTaskSchema(db)
  db.prepare(`
    UPDATE task_run_song_changes
    SET status = 'failed_download',
      phase = 'download',
      error_json = ?
    WHERE status = 'downloading'
  `).run(JSON.stringify({
    title: '重试中断',
    message: '任务因服务重启中断',
    stage: 'download',
  }))

  const rows = db.prepare("SELECT id FROM task_runs WHERE status = 'running'").all() as Array<{ id: string }>
  let changed = interruptedDownloads.length
  for (const row of rows) {
    const run = getRun(row.id)
    if (!run) continue
    const activeRequest = db.prepare(`
      SELECT 1 FROM source_sync_queue
      WHERE run_id = ? AND (
        (? = 'source_initialization' AND request_kind = 'analysis' AND status IN ('pending','running'))
        OR (status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at > ?)
      )
      LIMIT 1
    `).get(run.id, run.type, now)
    if (activeRequest) continue
    if (run.type === 'manual_download') {
      const synced = syncManualDownloadRun(run.id)
      if (synced?.status !== 'running') changed += 1
      continue
    }
    if (run.type === 'repair') {
      const repairTasks = db.prepare(`
        SELECT COUNT(*) AS count,
          SUM(CASE WHEN repair_task.status IN ('pending','downloading','tagging') THEN 1 ELSE 0 END) AS active
        FROM (
          SELECT task.id, task.status
          FROM run_file_tasks linked
          JOIN download_tasks task ON task.id = linked.task_id
          WHERE linked.run_id = ? AND task.operation = 'repair_existing'
          UNION
          SELECT task.id, task.status
          FROM download_tasks task
          WHERE COALESCE(task.run_id, task.job_id) = ? AND task.operation = 'repair_existing'
        ) repair_task
      `).get(run.id, run.id) as { count: number; active: number | null }
      if ((repairTasks.active ?? 0) > 0) {
        syncRepairRun(run.id)
        continue
      }
      // Media Repair has durable post-processing (Run projection + Plex refresh)
      // outside the file worker. Leave the Run recoverable even when every task
      // reached a terminal state just before the process stopped.
      if (repairTasks.count > 0) continue
      const synced = syncRepairRun(run.id)
      if (synced?.status !== 'running') changed += 1
      continue
    }
    const automaticallyRetried = run.trigger === 'schedule'
    run.status = automaticallyRetried ? 'cancelled' : 'failed'
    run.finishedAt = now
    run.durationMs = Math.max(0, Date.now() - new Date(run.startedAt).getTime())
    run.summary = automaticallyRetried
      ? '服务重启，已交由自动调度重新执行'
      : run.summary ? `${run.summary}（服务重启后中断）` : '任务因服务重启中断'
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
