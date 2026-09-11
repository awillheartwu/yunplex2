import type { AppConfig } from '../config/types'
import { setArtistAliases } from '../netease'
import { createSource, deleteSource, listSources } from '../playlist/store'
import { resolveSingleSongConfig } from './options'
import { createDownloadCommand } from './download-command'
import { selectDownloadResource, type DownloadResourceType } from './resource-selection'

export async function startSourceAttributedResourceDownload(input: {
  type: Exclude<DownloadResourceType, 'songs'>
  neteaseId: number
  selectedSongIds: number[]
  name?: string
  trackCount?: number
  coverUrl?: string
  quality?: string
  downloadLyrics?: boolean
  embedMetadata?: boolean
  embedCover?: boolean
  config: AppConfig
}): Promise<{
  sourceId: string
  batchId: string
  total: number
  selectionFailures: Array<{ songId: number; reason: string }>
}> {
  const duplicate = listSources().some(source => (
    source.type === input.type && source.neteasePlaylistId === input.neteaseId
  ))
  if (duplicate) throw new Error(input.type === 'album' ? '该专辑已是同步源' : '该歌单已是同步源')

  const selection = await selectDownloadResource({
    type: input.type,
    resourceId: input.neteaseId,
    selectedSongIds: input.selectedSongIds,
    cookie: input.config.netease.cookie,
  })
  if (selection.songs.length === 0) {
    const failure = selection.failures[0]
    throw new Error(failure ? `${failure.songId} ${failure.reason}` : '未找到可下载的歌曲')
  }

  const source = await createSource(input.neteaseId, input.config.netease.cookie, {
    type: input.type,
    subscribed: false,
    enabled: false,
    trackCount: input.trackCount ?? selection.songs.length,
    name: input.name || selection.sourceLabel,
    coverUrl: input.coverUrl,
  })

  try {
    setArtistAliases(
      input.config.other.artistAliases ?? {},
      input.config.other.applyAliasToAlbum ?? false,
    )
    const result = createDownloadCommand({
      selection,
      sourceContext: {
        id: source.id,
        name: `${input.name || selection.sourceLabel} · 下载并托管`,
      },
      config: {
        ...resolveSingleSongConfig(input.config, {
          quality: input.quality ?? input.config.netease.quality,
          downloadLyrics: input.downloadLyrics ?? input.config.download.downloadLyrics,
          embedMetadata: input.embedMetadata ?? input.config.download.embedMetadata,
          embedCover: input.embedCover ?? input.config.download.embedCover,
          downloadMode: 'full',
          target: { kind: 'computed', requireManagedCopy: true },
        }),
        artistAliases: input.config.other.artistAliases ?? {},
        applyAliasToAlbum: input.config.other.applyAliasToAlbum ?? false,
      },
    })
    return {
      sourceId: source.id,
      batchId: result.batchId,
      total: result.total,
      selectionFailures: result.selectionFailures,
    }
  } catch (error) {
    deleteSource(source.id)
    throw error
  }
}
