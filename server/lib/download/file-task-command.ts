import {
  enqueueTask,
  requeueFailedDownloadTasks,
  getDownloadTask,
  waitForDownloadTasks,
  type DownloadExecutionIntent,
  type DownloadTask,
  type DownloadTaskOperation,
} from './queue'
import { getDb, readConfigFromDb } from '../db'
import { createFileTaskSchema, linkRunFileTask } from '../db/file-task-schema'
import { requestDownloadProcessing } from './worker'
import { createHash } from 'node:crypto'
import { getSongIdentityBinding } from '../sync/identity-store'
import { isFileTaskSupersededByManualBinding } from './intent-identity'

export interface FileTaskIntent {
  sourceId?: string | null
  songId: number
  songName: string
  artist: string
  album: string
  quality?: string
  jobId: string
  idempotencyKey: string
  operation?: DownloadTaskOperation
  targetPath?: string
  executionIntent?: DownloadExecutionIntent
  retryFailed?: boolean
}

export interface FileTaskSubmission {
  task: DownloadTask
  reused: boolean
}

export interface FileTaskWaitOptions {
  timeoutMs?: number
  inactivityTimeoutMs?: number
  throwIfCancelled?: () => void
  pollIntervalMs?: number
  onProgress?: (progress: { settled: number; total: number }) => void
}

export interface FileTaskSubmissionHandle {
  readonly tasks: readonly FileTaskSubmission[]
  readonly taskIds: readonly string[]
  readonly ownedTaskIds: readonly string[]
  readonly reusedTaskIds: readonly string[]
  /** Start the global consumer without waiting for unrelated queue work. */
  wake(): void
  /** Wait only for the concrete task IDs represented by this handle. */
  wait(options?: FileTaskWaitOptions): Promise<void>
  /** Read current persisted outcomes for the actual tasks in this submission. */
  readResults(): DownloadTask[]
}

export function submitFileTasks(intents: readonly FileTaskIntent[]): FileTaskSubmissionHandle {
  // The application schema initializer should also call createFileTaskSchema.
  // Keeping this idempotent makes old databases safe during the transition and
  // keeps command transactions atomic when they are the first caller.
  createFileTaskSchema(getDb())
  const config = readConfigFromDb()
  const submissions = intents.map((intent) => {
    const binding = getSongIdentityBinding(intent.songId)
    const execution = intent.executionIntent ? {
      downloadDir: config.download.dir,
      pathFormat: config.other?.pathFormat ?? '{artist}/{album} ({year})/{title}',
      multiArtistFormat: config.other?.multiArtistFormat ?? 'ampersand',
      lyricOrder: config.other?.lyricOrder ?? 'original_first',
      downloadTranslatedLyric: config.other?.downloadTranslatedLyric ?? true,
      downloadRomajiLyric: config.other?.downloadRomajiLyric ?? false,
      artistAliases: config.other?.artistAliases ?? {},
      applyAliasToAlbum: config.other?.applyAliasToAlbum ?? false,
      ...intent.executionIntent,
      manualBindingVersion: binding?.status === 'active' && binding.bindingMethod === 'manual' ? binding.updatedAt : null,
    } : undefined
    if (execution?.artistAliases) execution.artistAliases = Object.fromEntries(Object.entries(execution.artistAliases).sort(([a], [b]) => a.localeCompare(b)))
    intent = { ...intent, executionIntent: execution }
    const target = execution?.target
    const fingerprint = JSON.stringify([
      intent.operation ?? 'download', intent.targetPath ?? null,
      execution?.downloadDir ?? null, execution?.pathFormat ?? null,
      execution?.multiArtistFormat ?? null, execution?.lyricOrder ?? null,
      execution?.artistAliases ?? null, execution?.applyAliasToAlbum ?? null,
      execution?.manualBindingVersion ?? null,
      execution?.downloadTranslatedLyric ?? null, execution?.downloadRomajiLyric ?? null,
      execution?.downloadMode ?? null,
      target?.kind === 'existing' ? [target.kind, target.path]
        : target ? [target.kind, target.protectedPath ?? null, target.requireManagedCopy ?? false] : null,
      execution?.downloadLyrics ?? null, execution?.embedMetadata ?? null, execution?.embedCover ?? null,
      execution?.saveAlbumCover ?? null, execution?.saveArtistImage ?? null,
    ])
    const idempotencyKey = execution
      ? `intent:${createHash('sha256').update(fingerprint).digest('hex')}:${intent.idempotencyKey}` : intent.idempotencyKey
    const previous = intent.retryFailed
      ? getDb().prepare("SELECT id FROM download_tasks WHERE idempotency_key = ? AND status = 'failed' ORDER BY updated_at DESC, rowid DESC LIMIT 1")
        .get(idempotencyKey) as { id: string } | undefined
      : undefined
    const previousTask = previous ? getDownloadTask(previous.id) : null
    const sameIntent = previousTask && previousTask.operation === (intent.operation ?? 'download')
      && previousTask.targetPath === intent.targetPath
      && JSON.stringify(previousTask.executionIntent) === JSON.stringify(intent.executionIntent)
    const task = (sameIntent && requeueFailedDownloadTasks([previousTask.id], { resumeRuns: false })[0]) || enqueueTask({ ...intent, idempotencyKey })
    linkRunFileTask(getDb(), {
      runId: intent.jobId,
      taskId: task.id,
      sourceId: intent.sourceId ?? null,
    })
    return {
      task,
      // enqueueTask returns the persisted owner for an active idempotent task.
      // Treat that owner as authoritative and never overwrite it here.
      reused: task.jobId !== intent.jobId,
    }
  })
  return createFileTaskSubmissionHandle(submissions)
}

/** Reattach a command to persisted task IDs while recovering after restart. */
export function createFileTaskWaitHandle(taskIds: readonly string[]): FileTaskSubmissionHandle {
  return createFileTaskSubmissionHandle([], [...taskIds])
}

/** File failures retain their original target, options and audio cache during source retries. */
export function getSourceFileRetryTasks(sourceId: string): Map<number, DownloadTask[]> {
  const rows = getDb().prepare(`
    SELECT download_task_ids FROM failure_records
    WHERE source_id = ? AND song_id IS NOT NULL AND status = 'open'
      AND TRIM(COALESCE(download_task_ids, '')) != ''
  `).all(sourceId) as Array<{ download_task_ids: string }>
  const tasksBySong = new Map<number, DownloadTask[]>()
  const selected = new Set<string>()
  // A system interruption can leave original writes pending without a file failure.
  const interrupted = getDb().prepare(`SELECT DISTINCT task.id FROM download_tasks task
    JOIN run_file_tasks caller ON caller.task_id=task.id
    JOIN task_runs run ON run.id=caller.run_id
    WHERE caller.source_id=? AND caller.paused=0 AND run.type='sync'
      AND run.status IN ('running','failed') AND task.status IN ('pending','downloading','tagging')`)
    .all(sourceId) as { id: string }[]
  rows.push(...interrupted.map(task => ({ download_task_ids: task.id })))
  for (const row of rows) {
    for (const id of row.download_task_ids.split(',')) {
      if (selected.has(id)) continue
      const task = getDownloadTask(id)
      if (!task || task.status === 'done') continue
      if (isFileTaskSupersededByManualBinding(task)) continue
      selected.add(id)
      const tasks = tasksBySong.get(task.songId) ?? []
      tasks.push(task)
      tasksBySong.set(task.songId, tasks)
    }
  }
  return tasksBySong
}

/** Attach retries to the current convergence without reopening their historical runs. */
export function resumeSourceFileTasks(tasks: readonly DownloadTask[], runId: string, sourceId: string): string[] {
  return getDb().transaction(() => {
    requeueFailedDownloadTasks(tasks.map(task => task.id), { resumeRuns: false })
    return tasks.map(task => {
      const current = getDownloadTask(task.id)!
      const active = current.status === 'failed' && current.idempotencyKey
        ? getDb().prepare(`SELECT id FROM download_tasks WHERE idempotency_key = ?
            AND status IN ('pending','downloading','tagging') ORDER BY created_at ASC LIMIT 1`)
          .get(current.idempotencyKey) as { id: string } | undefined : undefined
      const taskId = active?.id ?? current.id
      linkRunFileTask(getDb(), { runId, taskId, sourceId })
      return taskId
    })
  })()
}

function createFileTaskSubmissionHandle(
  submissions: readonly FileTaskSubmission[],
  taskIds = submissions.map(({ task }) => task.id),
): FileTaskSubmissionHandle {
  const ids = unique(taskIds)
  const ownedTaskIds = unique(
    submissions.filter(submission => !submission.reused).map(({ task }) => task.id),
  )
  const reusedTaskIds = unique(
    submissions.filter(submission => submission.reused).map(({ task }) => task.id),
  )

  return {
    tasks: submissions,
    taskIds: ids,
    ownedTaskIds,
    reusedTaskIds,
    wake: () => {
      // requestDownloadProcessing resolves when the global drain finishes.
      // Deliberately discard that promise: callers wait through wait(), which
      // observes only this handle's task IDs.
      void requestDownloadProcessing().catch(() => undefined)
    },
    wait: (options = {}) => waitForDownloadTasks({ ...options, taskIds: ids }),
    readResults: () => ids.map(id => getDownloadTask(id)).filter((task): task is DownloadTask => task !== null),
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}
