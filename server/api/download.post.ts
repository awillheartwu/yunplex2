import { success, fail } from '../lib/response'
import { readConfig } from '../lib/config/store'
import { runDownloadBatch } from '../lib/download/download-batch'
import { resolveSingleSongConfig } from '../lib/download/options'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    type: 'playlist' | 'album' | 'songs'
    neteaseId?: number
    songIds?: number[]
    quality?: string
    downloadLyrics?: boolean
    downloadImages?: boolean
    embedMetadata?: boolean
    plexEnabled?: boolean
  }>(event)

  if (!body || !['playlist', 'album', 'songs'].includes(body.type)) {
    return fail('type 必须为 playlist / album / songs')
  }

  if (body.type === 'songs' && (!body.songIds || body.songIds.length === 0)) {
    return fail('单曲下载需要提供 songIds')
  }

  if ((body.type === 'playlist' || body.type === 'album') && !body.neteaseId) {
    return fail(`${body.type} 下载需要提供 neteaseId`)
  }

  const cfg = readConfig()

  try {
    const result = await runDownloadBatch({
      type: body.type,
      neteaseId: body.neteaseId,
      songIds: body.songIds,
      config: {
        ...resolveSingleSongConfig(cfg, {
          quality: body.quality ?? cfg.netease.quality,
          downloadLyrics: body.downloadLyrics ?? cfg.download.downloadLyrics,
          embedMetadata: body.embedMetadata ?? cfg.download.embedMetadata,
          embedCover: body.downloadImages ?? cfg.download.embedCover,
          downloadMode: 'full',
        }),
        artistAliases: cfg.other?.artistAliases ?? {},
        applyAliasToAlbum: cfg.other?.applyAliasToAlbum ?? false,
      },
    })

    return success({
      batchId: result.batchId,
      total: result.total,
      selectionFailures: result.selectionFailures,
    }, result.selectionFailures.length > 0
      ? `已加入 ${result.total} 首歌曲，${result.selectionFailures.length} 首资源解析失败`
      : `下载已启动，共 ${result.total} 首歌曲`)
  } catch (err) {
    return fail(err, 1, 'failed_download')
  }
})
