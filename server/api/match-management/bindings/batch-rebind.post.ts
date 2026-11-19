import { randomUUID } from 'node:crypto'
import { DEFAULT_INITIALIZATION_MATCHING } from '../../../../shared/initialization-matching'
import type { BatchPlexBindingChoice, BatchPlexBindingResult, BatchPlexShareOwnerVersion } from '../../../../types/match-management'
import { readConfigFromDb } from '../../../lib/db'
import { sanitizeDiagnosticMessage } from '../../../lib/domain-error'
import { getSectionKey, getTracksByRatingKeys, initPlexClient } from '../../../lib/plex-client'
import { plexTrackFilePaths } from '../../../lib/plex-media'
import { fail, failDomain, success } from '../../../lib/response'
import { assessBatchPlexCandidate, batchPlexSong } from '../../../lib/sync/batch-plex-matches'
import { acquireIdentityMutationLock } from '../../../lib/sync/identity-coordinator'
import { normalizePlexPath } from '../../../lib/sync/identity-store'
import { getSyncWorker } from '../../../lib/sync/instance'
import { saveManualPlexBinding } from '../../../lib/sync/manual-plex-binding'

function validShareOwners(owners: BatchPlexShareOwnerVersion[] | undefined, songId: number): boolean {
  return owners === undefined || (Array.isArray(owners) && owners.length > 0 && owners.every(owner =>
    owner && Number.isSafeInteger(owner.songId) && owner.songId > 0 && owner.songId !== songId
    && typeof owner.updatedAt === 'string' && owner.updatedAt.trim(),
  ) && new Set(owners.map(owner => owner.songId)).size === owners.length)
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{ sourceId?: string; choices?: BatchPlexBindingChoice[] }>(event)
  const sourceId = typeof body?.sourceId === 'string' ? body.sourceId.trim() : ''
  const choices = body?.choices
  if (!sourceId || !Array.isArray(choices) || !choices.length || choices.some(choice =>
    !choice || !Number.isSafeInteger(choice.songId) || choice.songId <= 0
    || typeof choice.ratingKey !== 'string' || !/^\d+$/.test(choice.ratingKey)
    || typeof choice.plexFilePath !== 'string' || !choice.plexFilePath.trim()
    || (choice.expectedBindingUpdatedAt !== null && typeof choice.expectedBindingUpdatedAt !== 'string')
    || !validShareOwners(choice.confirmedShareOwners, choice.songId),
  ) || new Set(choices.map(choice => choice.songId)).size !== choices.length) {
    return failDomain('validation_failed', '请选择当前收藏中有效的歌曲和 Plex 文件')
  }

  try {
    const cfg = readConfigFromDb()
    await initPlexClient(cfg.plex)
    const [sectionKey, tracks] = await Promise.all([
      getSectionKey(cfg.plex.section),
      getTracksByRatingKeys(choices.map(choice => choice.ratingKey)),
    ])
    if (!sectionKey) return failDomain('validation_failed', '未找到 Plex 音乐库分区')
    const matching = cfg.initializationMatching ?? DEFAULT_INITIALIZATION_MATCHING
    // All successful bindings in this request share one alignment request per affected source.
    const changeId = randomUUID()
    const release = await acquireIdentityMutationLock()
    let results: BatchPlexBindingResult[]
    try {
      const sharedInThisBatch = new Map<string, BatchPlexShareOwnerVersion[]>()
      results = choices.map(choice => {
        const { songId, ratingKey, plexFilePath, expectedBindingUpdatedAt, confirmedShareOwners } = choice
        const track = tracks.get(ratingKey)
        try {
          const song = batchPlexSong(songId, sourceId)
          if (!song) return { songId, error: '这首歌已不在当前收藏' }
          if (!track) return { songId, error: 'Plex 曲目已不存在，请重新搜索' }
          const path = normalizePlexPath(plexFilePath)
          if (normalizePlexPath(plexTrackFilePaths(track)[0] ?? '') !== path) {
            return { songId, error: 'Plex 文件路径已变化，请重新选择' }
          }
          const candidate = assessBatchPlexCandidate(song, track, sectionKey, matching)
          if (!candidate) return { songId, error: '候选的曲名、艺人、版本或时长无法确认，请重新预览' }
          const key = JSON.stringify([ratingKey, path])
          const earlierShares = sharedInThisBatch.get(key) ?? []
          let sharedWithSongIds: number[] | undefined
          if (confirmedShareOwners) {
            if (candidate.shareIssue) return { songId, error: candidate.shareIssue }
            const versions = new Map([...confirmedShareOwners, ...earlierShares].map(owner => [owner.songId, owner.updatedAt]))
            if (candidate.owners.length !== versions.size || candidate.owners.some(owner => versions.get(owner.songId) !== owner.updatedAt)) {
              return { songId, error: '共用文件的关联已变化，请重新预览并确认' }
            }
            sharedWithSongIds = candidate.owners.map(owner => owner.songId)
          }
          const result = saveManualPlexBinding({
            songId, expectedBindingUpdatedAt, sourceId, track, sectionKey,
            sectionRoot: cfg.download.plexLibraryPathPrefix,
            batch: { changeId, plexFilePath, sharedWithSongIds },
          })
          if (confirmedShareOwners) sharedInThisBatch.set(key, [...earlierShares, { songId, updatedAt: result.binding.updatedAt }])
          return { songId, error: null }
        } catch (error) {
          return { songId, error: sanitizeDiagnosticMessage(error) ?? '关联保存失败' }
        }
      })
    } finally {
      release()
    }
    if (results.some(result => result.error === null)) void getSyncWorker()?.runOnce()
    return success(results)
  } catch (error) {
    return fail(error)
  }
})
