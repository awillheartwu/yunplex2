import { readConfig } from '../config/store'
import { getSource } from '../playlist/store'
import { listPlaylistSourceTrackOccurrences } from '../sync/match-management-store'
import { runDownloadBatch, type DownloadBatchResult } from './download-batch'
import { resolveSingleSongConfig } from './options'

export async function startManagedSongDownload(input: {
  sourceId: string
  neteaseSongId: number
}): Promise<DownloadBatchResult> {
  const source = getSource(input.sourceId)
  if (!source) throw new Error('同步源不存在')
  const belongsToSource = listPlaylistSourceTrackOccurrences(source.id)
    .some(item => item.neteaseSongId === input.neteaseSongId)
  if (!belongsToSource) throw new Error('这首歌已不在当前同步源中')

  const cfg = readConfig()
  return runDownloadBatch({
    type: 'songs',
    songIds: [input.neteaseSongId],
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
    },
  })
}
