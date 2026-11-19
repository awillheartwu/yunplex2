import type { ManagedDownloadBatchResult } from '../../../types/match-management'
import { readConfig } from '../config/store'
import { sanitizeDiagnosticMessage } from '../domain-error'
import { getSource } from '../playlist/store'
import type { PlaylistSource } from '../playlist/types'
import { getSongIdentityBindings } from '../sync/identity-store'
import { listPlaylistSourceTrackOccurrences } from '../sync/match-management-store'
import { resolveDownloadBatchSelection, runDownloadBatch, type DownloadBatchResult } from './download-batch'
import { createDownloadCommand } from './download-command'
import { resolveSingleSongConfig } from './options'
import type { ResourceSelectionFailure } from './resource-selection'

function managedDownloadContext(source: PlaylistSource) {
  const cfg = readConfig()
  return {
    sourceContext: {
      id: source.id,
      name: `${source.name || source.neteasePlaylistName || '同步源'} · 下载并托管`,
    },
    config: {
      ...resolveSingleSongConfig(cfg, {
        quality: cfg.netease.quality,
        downloadLyrics: cfg.download.downloadLyrics,
        embedMetadata: cfg.download.embedMetadata,
        embedCover: cfg.download.embedCover,
        downloadMode: 'full',
        target: { kind: 'computed', requireManagedCopy: true },
      }),
      artistAliases: cfg.other.artistAliases ?? {},
      applyAliasToAlbum: cfg.other.applyAliasToAlbum ?? false,
      bindAfterDownload: true,
    },
  }
}

export async function startManagedSongDownload(input: {
  sourceId: string
  neteaseSongId: number
}): Promise<DownloadBatchResult> {
  const source = getSource(input.sourceId)
  if (!source) throw new Error('同步源不存在')
  const belongsToSource = listPlaylistSourceTrackOccurrences(source.id)
    .some(item => item.neteaseSongId === input.neteaseSongId)
  if (!belongsToSource) throw new Error('这首歌已不在当前同步源中')

  return runDownloadBatch({
    type: 'songs',
    songIds: [input.neteaseSongId],
    ...managedDownloadContext(source),
  })
}

function eligibleManagedSongIds(sourceId: string, ids: number[], failures: ResourceSelectionFailure[]): number[] {
  if (!ids.length) return []
  const members = new Set(listPlaylistSourceTrackOccurrences(sourceId).map(item => item.neteaseSongId))
  const bindings = getSongIdentityBindings(ids.filter(id => members.has(id)))
  return ids.filter((songId) => {
    const binding = bindings.get(songId)
    if (!members.has(songId)) {
      failures.push({ songId, reason: '这首歌已不在当前同步源中' })
      return false
    }
    if (binding && binding.status !== 'unbound') {
      failures.push({ songId, reason: '这首歌已有媒体关联，请单独处理' })
      return false
    }
    return true
  })
}

export async function startManagedSongDownloads(sourceId: string, songIds: number[]): Promise<ManagedDownloadBatchResult> {
  const source = getSource(sourceId)
  if (!source) throw new Error('同步源不存在')
  const selectionFailures: ResourceSelectionFailure[] = []
  const eligible = eligibleManagedSongIds(sourceId, [...new Set(songIds)], selectionFailures)
  if (!eligible.length) return { batchId: null, total: 0, selectionFailures }

  const context = managedDownloadContext(source)
  const selection = await resolveDownloadBatchSelection({ type: 'songs', songIds: eligible, ...context })
  for (const { songId, reason } of selection.failures) {
    selectionFailures.push({ songId, reason: sanitizeDiagnosticMessage(reason) || '获取歌曲信息失败' })
  }
  // The source or a binding can change while the upstream song details are loading.
  const current = new Set(eligibleManagedSongIds(sourceId, selection.songs.map(song => song.id), selectionFailures))
  const songs = selection.songs.filter(song => current.has(song.id))
  if (!songs.length) return { batchId: null, total: 0, selectionFailures }

  const { batchId, total } = createDownloadCommand({ ...context, selection: { ...selection, songs, failures: selectionFailures } })
  return { batchId, total, selectionFailures }
}
