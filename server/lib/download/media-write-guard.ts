import { relative, resolve } from 'node:path'
import { getDb, readConfigFromDb } from '../db'
import { acquireIdentityMutationLock } from '../sync/identity-coordinator'
import { normalizePlexPath } from '../sync/identity-normalization'
import { assertMediaCorrectionCurrent } from '../sync/media-corrections'
import { mapLocalPathToPlex } from '../sync/path-map'
import { assertFileTaskIdentityCurrent } from './intent-identity'

const targetWrites = new Map<string, Promise<void>>()

/** Hold the actual output path until publication and asset registration finish. */
export async function withMediaWriteTarget<T>(filePath: string, songId: number, write: () => Promise<T>): Promise<T> {
  const key = normalizePlexPath(resolve(filePath))
  const previous = targetWrites.get(key) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const tail = previous.then(() => gate)
  targetWrites.set(key, tail)
  await previous
  try {
    assertMediaPathAvailable(filePath, songId)
    return await write()
  } finally {
    release()
    if (targetWrites.get(key) === tail) targetWrites.delete(key)
  }
}

function assertMediaPathAvailable(filePath: string, songId: number): void {
  const localPath = resolve(filePath)
  const relativePath = relative(process.cwd(), localPath)
  const plexPath = mapLocalPathToPlex(localPath, readConfigFromDb())
  const owner = getDb().prepare(`
    SELECT netease_song_id AS song_id FROM local_media_assets
      WHERE file_path IN (?, ?) AND netease_song_id != ?
    UNION ALL
    SELECT song_id FROM media_corrections
      WHERE status = 'ready' AND json_extract(staged_asset_json, '$.filePath') IN (?, ?) AND song_id != ?
    UNION ALL
    SELECT netease_song_id AS song_id FROM song_identity_bindings
      WHERE plex_file_path = ? AND netease_song_id != ? AND status = 'active'
    LIMIT 1
  `).get(localPath, relativePath, songId, localPath, relativePath, songId,
    plexPath ? normalizePlexPath(plexPath) : null, songId) as { song_id: number } | undefined
  if (owner) throw Object.assign(new Error(`媒体身份冲突：目标文件已归属网易云歌曲 #${owner.song_id}；请调整命名模板或手动复用已有媒体，未自动改名或覆盖`), { code: 'MEDIA_IDENTITY_CONFLICT' })
}

/** Keep correction validation, final rename and durable media fact indivisible to identity changes. */
export async function publishMediaWrite<T>(input: {
  songId: number
  filePath: string
  taskId?: string
  signal?: AbortSignal
  manualBindingVersion?: string | null
  taskCreatedAt?: string
}, publish: () => Promise<T>): Promise<T> {
  const release = await acquireIdentityMutationLock()
  try {
    input.signal?.throwIfAborted()
    assertFileTaskIdentityCurrent({ songId: input.songId, createdAt: input.taskCreatedAt,
      executionIntent: { manualBindingVersion: input.manualBindingVersion } })
    assertMediaPathAvailable(input.filePath, input.songId)
    assertMediaCorrectionCurrent(input.songId, input.taskId)
    return await publish()
  } finally { release() }
}
