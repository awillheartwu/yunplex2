import { getSource } from '../../../lib/playlist/store'
import { fail, success } from '../../../lib/response'
import { getActiveSongIdentityBindings } from '../../../lib/sync/identity-store'
import { getLocalMediaAsset } from '../../../lib/sync/local-media-store'
import { listPlaylistSourceTrackOccurrences } from '../../../lib/sync/match-management-store'
import { decideRedownload, type RedownloadDisposition } from '../../../lib/sync/redownload-policy'

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  if (!id) return fail('缺少 ID')
  const source = getSource(id)
  if (!source) return fail('歌单源不存在')
  if (source.type !== 'playlist') return fail('重新下载托管音频仅支持歌单同步源')

  const occurrenceIds = listPlaylistSourceTrackOccurrences(source.id)
    .map(item => item.neteaseSongId)
  const snapshotIds = parseSnapshot(source.trackIdSnapshot)
  const scopedIds = occurrenceIds.length > 0 ? occurrenceIds : snapshotIds
  const songIds = [...new Set(scopedIds)]
  const bindings = getActiveSongIdentityBindings(songIds)
  const counts: Record<RedownloadDisposition, number> = {
    replace_managed: 0,
    download_missing: 0,
    replace_external: 0,
    skip_external: 0,
    skip_manual_binding: 0,
  }

  for (const songId of songIds) {
    const decision = decideRedownload({
      asset: getLocalMediaAsset(songId),
      binding: bindings.get(songId) ?? null,
      takeOverExternal: false,
    })
    counts[decision.disposition]++
  }

  return success({
    sourceId: source.id,
    total: songIds.length,
    managed: counts.replace_managed,
    missing: counts.download_missing,
    protectedExternal: counts.skip_external,
    protectedManual: counts.skip_manual_binding,
    eligible: counts.replace_managed + counts.download_missing,
    snapshotAvailable: songIds.length > 0,
  })
})

function parseSnapshot(raw: string | null): number[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed)
      ? parsed.map(Number).filter(value => Number.isSafeInteger(value) && value > 0)
      : []
  } catch {
    return []
  }
}
