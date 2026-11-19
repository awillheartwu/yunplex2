import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { getDb, readConfigFromDb } from '../db'
import { withExternalRequestSignal } from '../external-request-context'
import { findTracksByFilePath, getSectionKey, initPlexClient } from '../plex-client'
import { plexTrackFilePaths } from '../plex-media'
import { resolveMediaDecision } from '../source-initialization/store'
import { emitEvent } from '../sync/events'
import { acquireIdentityMutationLock } from '../sync/identity-coordinator'
import { plexPathsExactlyEqual } from '../sync/identity-normalization'
import { findPlexIdentityOwners, getSongIdentityBinding } from '../sync/identity-store'
import { getLocalMediaAsset, isVerifiedManagedFile } from '../sync/local-media-store'
import { bindResolvedIdentity } from '../sync/lookup-identity'
import { getMediaCorrection, queueIdentityRealignment } from '../sync/media-corrections'
import { mapLocalPathToPlex } from '../sync/path-map'
import { plexRecoveryConfigFingerprint } from '../sync/plex-index-recovery'
import { confirmSongIdentity } from '../tasks/completion'
import { scanManagedDownload } from './managed-media-scan'
import { getDownloadTask, type DownloadTask } from './queue'

interface PendingBinding {
  songId: number
  filePath: string
  taskId: string
  attempts: number
}

function requestingSources(task: DownloadTask): string[] {
  const rows = getDb().prepare(`
    SELECT DISTINCT caller.source_id AS id FROM run_file_tasks caller
    JOIN task_runs run ON run.id=caller.run_id AND run.status<>'cancelled'
    JOIN playlist_source_track_occurrences song ON song.source_id=caller.source_id
      AND song.netease_song_id=? AND song.membership_status='current'
    WHERE caller.task_id=? AND NOT EXISTS (
      SELECT 1 FROM source_media_decisions decision
      WHERE decision.source_id=caller.source_id AND decision.netease_song_id=song.netease_song_id
        AND decision.disposition='defer' AND decision.resolved_at IS NULL AND decision.updated_at>caller.created_at
    )
  `).all(task.songId, task.id) as { id: string }[]
  return rows.map(row => row.id)
}

/** The file task commits this work together with its managed asset. The source worker checks Plex on later ticks. */
export async function reconcileManagedDownloadBindings(): Promise<void> {
  const db = getDb()
  const rows = db.prepare(`
    SELECT netease_song_id AS songId, file_path AS filePath,
      json_extract(evidence_json, '$.managedBinding.taskId') AS taskId,
      json_extract(evidence_json, '$.managedBinding.attempts') AS attempts
    FROM local_media_assets WHERE json_extract(evidence_json, '$.managedBinding.availableAt') <= ?
    ORDER BY json_extract(evidence_json, '$.managedBinding.availableAt'), netease_song_id LIMIT 25
  `).all(new Date().toISOString()) as PendingBinding[]
  if (!rows.length) return

  const config = readConfigFromDb()
  const fingerprint = plexRecoveryConfigFingerprint(config)
  const lookups = new Map<number, { path: string; keys: string[] }>()
  const section = await withExternalRequestSignal(AbortSignal.timeout(25_000), async () => {
    await initPlexClient(config.plex)
    const key = await getSectionKey(config.plex.section)
    if (!key) return null
    for (const row of rows) {
      const path = mapLocalPathToPlex(row.filePath, config)
      if (!path) continue
      const tracks = await findTracksByFilePath(key, path)
      const keys = tracks.filter(track => plexTrackFilePaths(track).some(file => plexPathsExactlyEqual(file, path)))
        .map(track => track.ratingKey)
      lookups.set(row.songId, { path, keys: [...new Set(keys)] })
    }
    return key
  }).catch(() => null)

  const scanAgain = new Map<string, PendingBinding>()
  const changedSources = new Set<string>()
  const release = await acquireIdentityMutationLock()
  try {
    if (plexRecoveryConfigFingerprint(readConfigFromDb()) !== fingerprint) return
    const changeId = randomUUID()
    const finish = db.prepare(`UPDATE local_media_assets SET evidence_json=json_set(
      json_remove(evidence_json,'$.managedBinding'),'$.managedBindingIssue',?) WHERE netease_song_id=?`)
    const wait = db.prepare(`UPDATE local_media_assets SET evidence_json=json_set(evidence_json,
      '$.managedBinding.attempts',?, '$.managedBinding.availableAt',?) WHERE netease_song_id=?`)
    db.transaction(() => {
      for (const row of rows) {
        const asset = getLocalMediaAsset(row.songId)
        if ((asset?.evidence.managedBinding as { taskId?: string } | undefined)?.taskId !== row.taskId) continue
        const task = getDownloadTask(row.taskId)
        const binding = getSongIdentityBinding(row.songId)
        const expected = task?.executionIntent?.managedBindingVersion
        const sources = task ? requestingSources(task) : []
        if (!task || task.status !== 'done' || !sources.length || expected === undefined
          || (binding?.updatedAt ?? null) !== expected || (binding && binding.status !== 'unbound') || getMediaCorrection(row.songId)) {
          finish.run(null, row.songId)
          continue
        }
        if (!isVerifiedManagedFile(asset) || asset.filePath !== row.filePath || task.filePath !== row.filePath) {
          sources.forEach(source => changedSources.add(source))
          finish.run('已下载的文件发生变化，请重新核对媒体。', row.songId)
          continue
        }
        const match = lookups.get(row.songId)
        const ratingKey = match?.keys.length === 1 ? match.keys[0] : undefined
        if (section && match && ratingKey) {
          sources.forEach(source => changedSources.add(source))
          if (findPlexIdentityOwners({ neteaseSongId: row.songId, plexFilePath: match.path, plexRatingKey: ratingKey }).length) {
            finish.run('Plex 将新文件归到了已有歌曲，请手动核对。', row.songId)
            continue
          }
          bindResolvedIdentity(row.songId, section, config.download.plexLibraryPathPrefix, ratingKey, match.path, {
            source: 'managed_download', ownership: 'managed', taskId: task.id,
          })
          for (const source of sources) {
            resolveMediaDecision(source, row.songId)
            confirmSongIdentity(source, { songId: row.songId, songName: task.songName, ratingKey, plexFilePath: match.path })
          }
          const { affectedSources } = queueIdentityRealignment(row.songId, changeId)
          affectedSources.forEach(source => changedSources.add(source.id))
          finish.run(null, row.songId)
        } else if (row.attempts >= config.sync.plexScanRetries) {
          sources.forEach(source => changedSources.add(source))
          finish.run(match && match.keys.length > 1 ? '新文件在 Plex 中对应多个曲目，请手动核对。'
            : '文件已保存，Plex 尚未确认收录。', row.songId)
        } else {
          const next = new Date(Date.now() + config.sync.plexScanRetryDelaySec * 1000).toISOString()
          wait.run(row.attempts + 1, next, row.songId)
          if (row.attempts === 0) scanAgain.set(dirname(row.filePath), row)
        }
      }
    })()
  } finally { release() }

  if (changedSources.size) emitEvent({ type: 'media-binding-update', data: { sourceIds: [...changedSources] }, timestamp: new Date().toISOString() })

  // Reissue a scoped scan on the first miss, including after a restart between commit and scan.
  for (const row of scanAgain.values()) void scanManagedDownload(getDownloadTask(row.taskId)?.songName || String(row.songId), row.filePath)
}
