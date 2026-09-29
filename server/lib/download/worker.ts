import {
  listPendingDownloadTaskIds,
  processAll,
  type DownloadProcessor,
  type DownloadTask,
} from './queue'
import type { AppConfig } from '../config/types'
import { downloadSingleSong } from './single-song'
import { resolveSingleSongConfig } from './options'

export interface DownloadWorker {
  getStatus: () => 'ready' | 'failed' | 'stopping'
  wake: () => Promise<void>
  waitForIdle: () => Promise<void>
  stop: () => Promise<void>
}

export function createDownloadWorker(input: {
  getConcurrency: () => number
  execute: DownloadProcessor
}): DownloadWorker {
  let activeDrain: Promise<void> | null = null
  let resolveDrain: (() => void) | null = null
  let rejectDrain: ((error: unknown) => void) | null = null
  const activeTasks = new Set<string>()
  let stopping = false
  let failure: unknown

  function settleIdle() {
    if (activeTasks.size > 0) return
    const resolve = resolveDrain, reject = rejectDrain
    activeDrain = null
    resolveDrain = null
    rejectDrain = null
    if (failure) reject?.(failure)
    else resolve?.()
  }

  function pump() {
    try {
      if (!stopping) {
        const configured = input.getConcurrency()
        const concurrency = Number.isFinite(configured) ? Math.max(1, Math.trunc(configured)) : 1
        const freeSlots = Math.max(0, concurrency - activeTasks.size)
        const ids = freeSlots ? listPendingDownloadTaskIds(freeSlots) : []
        for (const id of ids) {
          if (activeTasks.size >= concurrency) break
          if (activeTasks.has(id)) continue
          activeTasks.add(id)
          // Keep persistence, leases, validation and finalization in processAll.
          // One task per slot lets wakeups fill spare capacity during a long task.
          void processAll(input.execute, undefined, 1, [id], {
            shouldStop: () => stopping,
          }).then(() => {
            activeTasks.delete(id)
            pump()
          }, error => {
            failure = error
            stopping = true
            activeTasks.delete(id)
            settleIdle()
          })
        }
      }
    } catch (error) {
      failure = error
      stopping = true
    }
    settleIdle()
  }

  const wake = (): Promise<void> => {
    if (stopping) return Promise.reject(new Error('下载消费者正在停止'))
    if (!activeDrain) {
      activeDrain = new Promise<void>((resolve, reject) => {
        resolveDrain = resolve
        rejectDrain = reject
      })
    }
    const pending = activeDrain
    pump()
    return pending
  }

  const waitForIdle = async () => {
    while (activeDrain) await activeDrain
  }

  const stop = async () => {
    stopping = true
    await waitForIdle()
  }

  return { wake, waitForIdle, stop, getStatus: () => failure ? 'failed' : stopping ? 'stopping' : 'ready' }
}

function executionOverrides(task: DownloadTask): Parameters<typeof resolveSingleSongConfig>[1] {
  const persisted = task.executionIntent
  if (persisted) {
    return {
      quality: task.quality,
      downloadMode: persisted.downloadMode,
      target: persisted.target,
      downloadLyrics: persisted.downloadLyrics,
      embedMetadata: persisted.embedMetadata,
      embedCover: persisted.embedCover,
    }
  }
  if (task.operation === 'repair_existing') {
    return {
      quality: task.quality,
      downloadMode: 'missing',
      target: task.targetPath ? { kind: 'existing', path: task.targetPath } : undefined,
      embedMetadata: true,
      embedCover: false,
    }
  }
  if (task.operation === 'replace') {
    return {
      quality: task.quality,
      downloadMode: 'replace',
      target: task.targetPath ? { kind: 'existing', path: task.targetPath } : undefined,
    }
  }
  if (task.operation === 'managed_copy') {
    return {
      quality: task.quality,
      downloadMode: 'full',
      target: {
        kind: 'computed',
        requireManagedCopy: true,
        ...(task.targetPath ? { protectedPath: task.targetPath } : {}),
      },
    }
  }
  return {
    quality: task.quality,
    downloadMode: 'full',
    ...(task.targetPath
      ? { target: { kind: 'computed' as const, protectedPath: task.targetPath } }
      : {}),
  }
}

let singleton: DownloadWorker | null = null

export function startDownloadWorker(
  getConfig: () => AppConfig,
  execute?: DownloadProcessor,
): DownloadWorker {
  if (singleton) return singleton
  singleton = createDownloadWorker({
    getConcurrency: () => getConfig().sync.downloadConcurrency || 1,
    execute: execute ?? ((task, onProgress, signal) => downloadSingleSong(
        task.songId,
        resolveSingleSongConfig(getConfig(), executionOverrides(task)),
        onProgress,
        signal,
      )),
  })
  void singleton.wake().catch(() => undefined)
  return singleton
}

export function getDownloadWorker(): DownloadWorker | null {
  return singleton
}

export function requestDownloadProcessing(): Promise<void> {
  if (!singleton) return Promise.reject(new Error('下载消费者尚未启动'))
  return singleton.wake()
}

export async function waitForDownloadWorkerIdle(): Promise<void> {
  await singleton?.waitForIdle()
}

export async function stopDownloadWorker(): Promise<void> {
  const current = singleton
  singleton = null
  await current?.stop()
}
