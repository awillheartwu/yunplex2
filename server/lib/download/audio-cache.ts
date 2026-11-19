import { createHash } from 'node:crypto'
import { lstatSync, readdirSync, unlinkSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { validateLocalAudioFile } from '../media-validation'

export interface DownloadAudioCache {
  directory: string
  taskId: string
}

const AUDIO_TYPES = ['flac', 'mp3'] as const
const ORPHAN_GRACE_MS = 60 * 60 * 1000

function cacheKey(taskId: string): string {
  return createHash('sha256').update(taskId).digest('hex')
}

export function cachedAudioPath(cache: DownloadAudioCache, fileType: string): string {
  if (!AUDIO_TYPES.some(type => type === fileType)) throw new Error('不支持缓存此音频格式')
  return join(cache.directory, `${cacheKey(cache.taskId)}.${fileType}`)
}

/** Only completed, validated downloads are renamed into these private files. */
export function findCachedAudio(cache: DownloadAudioCache): { filePath: string; fileType: string } | null {
  for (const fileType of AUDIO_TYPES) {
    const filePath = cachedAudioPath(cache, fileType)
    let stat
    try { stat = lstatSync(filePath) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    if (stat.isFile() && validateLocalAudioFile(filePath, fileType).valid) return { filePath, fileType }
    // An incomplete or invalid cache never becomes a media asset.
    unlinkSync(filePath)
  }
  return null
}

export async function prepareAudioCache(cache: DownloadAudioCache): Promise<void> {
  await mkdir(cache.directory, { recursive: true, mode: 0o700 })
}

export async function clearAudioCache(cache: DownloadAudioCache): Promise<void> {
  try {
    await Promise.all(AUDIO_TYPES.map(type => rm(cachedAudioPath(cache, type), { force: true })))
  } catch {
    // The task has already committed; maintenance retries cache cleanup.
    console.warn('[YunPlex2] 下载缓存暂未清理，稍后自动维护重试')
  }
}

/** Keep active tasks, and expire failed/orphaned cache files with task retention. */
export function pruneAudioCache(input: {
  directory: string
  tasks: Array<{ id: string; status: string }>
  retainAfter: number
  now: number
}): void {
  let files: string[]
  try { files = readdirSync(input.directory) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  const tasks = new Map(input.tasks.map(task => [cacheKey(task.id), task.status]))
  for (const file of files) {
    const match = /^([a-f0-9]{64})\.(?:flac|mp3)(?:\.part-[\w-]+)?$/.exec(file)
    if (!match) continue
    const status = tasks.get(match[1]!)
    if (status === 'downloading' || status === 'tagging') continue
    const path = join(input.directory, file)
    try {
      const stat = lstatSync(path)
      if (stat.mtimeMs >= input.now - ORPHAN_GRACE_MS) continue
      if (!status || status === 'done' || stat.mtimeMs < input.retainAfter) unlinkSync(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}
