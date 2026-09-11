import { readConfigFromDb } from '../../../../lib/db'
import { fail, success } from '../../../../lib/response'
import {
  getSectionKey,
  getTrackByRatingKey,
  initPlexClient,
} from '../../../../lib/plex-client'
import {
  BindingIdentityConflictError,
  BindingVersionConflictError,
  normalizePlexPath,
  rebindSongIdentity,
} from '../../../../lib/sync/identity-store'
import { acquireIdentityMutationLock } from '../../../../lib/sync/identity-coordinator'

export default defineEventHandler(async (event) => {
  const songId = Number(getRouterParam(event, 'songId'))
  if (!Number.isSafeInteger(songId) || songId <= 0) return fail('无效的网易云歌曲 ID')
  const body = await readBody<{
    ratingKey?: string
    expectedBindingUpdatedAt?: string | null
    sourceId?: string
  }>(event)
  const ratingKey = body.ratingKey?.trim()
  if (!ratingKey) return fail('请选择 Plex 曲目')
  if (!Object.prototype.hasOwnProperty.call(body, 'expectedBindingUpdatedAt')) {
    return fail('缺少绑定版本，请刷新后重试')
  }
  try {
    const cfg = readConfigFromDb()
    await initPlexClient(cfg.plex)
    const [track, sectionKey] = await Promise.all([
      getTrackByRatingKey(ratingKey),
      getSectionKey(cfg.plex.section),
    ])
    if (!track) return fail('Plex 曲目已不存在，请重新搜索')
    if (!sectionKey) return fail('未找到 Plex 音乐库分区')
    const plexFilePath = track.Media?.flatMap(media =>
      media.Part?.flatMap(part => part.file ? [part.file] : []) ?? [],
    )[0]
    if (!plexFilePath) return fail('Plex 曲目没有可绑定的媒体路径')
    const release = await acquireIdentityMutationLock()
    try {
      const result = rebindSongIdentity({
        neteaseSongId: songId,
        expectedBindingUpdatedAt: body.expectedBindingUpdatedAt ?? null,
        sourceId: body.sourceId,
        binding: {
          plexSectionKey: sectionKey,
          plexSectionRoot: cfg.download.plexLibraryPathPrefix,
          plexFilePath: normalizePlexPath(plexFilePath),
          plexRatingKey: track.ratingKey,
          evidence: {
            selectedBy: 'user',
            selectedRatingKey: track.ratingKey,
            identityRule: 'explicit_adoption',
          },
        },
      })
      return success(result, '全局绑定已更新；受影响歌单将在下次同步时对齐')
    } finally {
      release()
    }
  } catch (error) {
    const conflict = error instanceof BindingVersionConflictError || error instanceof BindingIdentityConflictError
    if (conflict) {
      setResponseStatus(event, 409)
    }
    return fail(error instanceof Error ? error.message : '重绑失败', conflict ? 409 : 1)
  }
})
