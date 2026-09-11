import {
  enqueueTask,
  getDownloadTask,
  waitForDownloadTasks,
  type DownloadExecutionIntent,
  type DownloadTask,
  type DownloadTaskOperation,
} from './queue'
import { getDb } from '../db'
import { createFileTaskSchema, linkRunFileTask } from '../db/file-task-schema'
import { requestDownloadProcessing } from './worker'

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
}

export interface FileTaskSubmission {
  task: DownloadTask
  reused: boolean
}

export interface FileTaskWaitOptions {
  timeoutMs?: number
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
  const submissions = intents.map((intent) => {
    const task = enqueueTask(intent)
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
