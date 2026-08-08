import { success, fail } from '../lib/response'
import { readConfig } from '../lib/config/store'
import { runDownloadBatch } from '../lib/download/download-batch'

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
        quality: body.quality ?? cfg.netease.quality,
        cookie: cfg.netease.cookie,
        downloadDir: cfg.download.dir,
        pathFormat: cfg.other?.pathFormat ?? '{artist}/{album} ({year})/{title}',
        multiArtistFormat: cfg.other?.multiArtistFormat ?? 'ampersand',
        downloadLyrics: body.downloadLyrics ?? cfg.download.downloadLyrics,
        embedMetadata: body.embedMetadata ?? cfg.download.embedMetadata,
        embedCover: body.downloadImages ?? cfg.download.embedCover,
        saveAlbumCover: cfg.download.saveAlbumCover ?? false,
        saveArtistImage: cfg.download.saveArtistImage ?? false,
        lyricOrder: (cfg.other?.lyricOrder ?? 'original_first') as 'original_first' | 'translated_first',
        downloadTranslatedLyric: cfg.other?.downloadTranslatedLyric ?? true,
        downloadRomajiLyric: cfg.other?.downloadRomajiLyric ?? false,
        downloadMode: 'full',
        artistAliases: cfg.other?.artistAliases ?? {},
        applyAliasToAlbum: cfg.other?.applyAliasToAlbum ?? false,
        downloadConcurrency: cfg.sync.downloadConcurrency || 3,
      },
    })

    return success({
      batchId: result.batchId,
      total: result.total,
    }, `下载已启动，共 ${result.total} 首歌曲`)
  } catch (err) {
    const message = err instanceof Error ? err.message : '启动下载失败'
    return fail(message)
  }
})
