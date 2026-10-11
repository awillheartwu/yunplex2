import { getDb } from '../db'
import { getSongIdentityBinding, normalizePlexPath } from '../sync/identity-store'
import { sharedMediaReview } from '../../../shared/shared-media'
import { assertAwaitingReview, refreshDecisionCounts } from './store'
import { InitializationConflictError } from './errors'
import { matchingFingerprint } from './matching-snapshot'

function rowFor(initializationId: string, songId: number) {
  return getDb().prepare('SELECT * FROM source_initialization_items WHERE initialization_id=? AND netease_song_id=?').get(initializationId, songId) as Record<string, unknown> | undefined
}
/** Explicitly stages the entire displayed group; does not write identities or Plex. */
export function confirmSharedMedia(initializationId: string, songId: number, fingerprint: string): number {
  return getDb().transaction(() => {
    assertAwaitingReview(initializationId)
    const row = rowFor(initializationId, songId)
    const evidence = JSON.parse(String(row?.evidence_json || '{}'))
    const review = sharedMediaReview(evidence)
    if (!review || matchingFingerprint(review) !== fingerprint) throw new InitializationConflictError('共享媒体方案已变化，请刷新后重新确认')
    if (/\[netease-\d+\]/i.test(review.filePath)) throw new InitializationConflictError('文件包含明确歌曲身份，不能共享确认')
    for (const song of review.songs) {
      const peer = rowFor(initializationId, song.songId)
      if (!peer || (getSongIdentityBinding(song.songId)?.updatedAt ?? null) !== song.bindingVersion) throw new InitializationConflictError('歌曲关联已变化，请重新分析')
      if (peer.tier === 'preserved') {
        if (peer.candidate_rating_key !== review.ratingKey || normalizePlexPath(String(peer.candidate_file_path)) !== normalizePlexPath(review.filePath)) throw new InitializationConflictError('已有绑定已变化')
        continue
      }
      const peerEvidence = JSON.parse(String(peer.evidence_json))
      if (matchingFingerprint(sharedMediaReview(peerEvidence)) !== fingerprint) throw new InitializationConflictError('共享组不一致，请重新分析')
      const candidate = (JSON.parse(String(peer.candidates_json)) as Array<{ratingKey: string; filePath: string; title: string; artist: string; album: string; durationMs: number | null}>).find(item => item.ratingKey === review.ratingKey && normalizePlexPath(item.filePath || '') === normalizePlexPath(review.filePath))
      if (!candidate) throw new InitializationConflictError('共享候选已不存在')
      peerEvidence.sharedMediaConfirmed = fingerprint
      getDb().prepare("UPDATE source_initialization_items SET candidate_rating_key=?,candidate_file_path=?,candidate_title=?,candidate_artist=?,candidate_album=?,candidate_duration_ms=?,decision='adopt',decision_status='proposed',evidence_json=?,updated_at=? WHERE initialization_id=? AND netease_song_id=?")
        .run(review.ratingKey, review.filePath, candidate.title, candidate.artist, candidate.album, candidate.durationMs, JSON.stringify(peerEvidence), new Date().toISOString(), initializationId, song.songId)
    }
    refreshDecisionCounts(initializationId)
    return review.songs.length
  })()
}

/** Called inside the identity lock, before any writes. Revalidate all peers and their versions. */
export function sharedMediaPermissions(initializationId: string): Map<number, number[]> {
  const permissions = new Map<number, number[]>()
  const rows = getDb().prepare('SELECT * FROM source_initialization_items WHERE initialization_id=?').all(initializationId) as Array<Record<string, unknown>>
  const byId = new Map(rows.map(row => [Number(row.netease_song_id), row]))
  for (const row of rows) {
    const evidence = JSON.parse(String(row.evidence_json))
    const review = sharedMediaReview(evidence)
    if (!review || evidence.sharedMediaConfirmed !== matchingFingerprint(review)) continue
    const valid = review.songs.every(song => {
      const peer = byId.get(song.songId)
      if (!peer || (getSongIdentityBinding(song.songId)?.updatedAt ?? null) !== song.bindingVersion) return false
      return peer.candidate_rating_key === review.ratingKey && normalizePlexPath(String(peer.candidate_file_path || '')) === normalizePlexPath(review.filePath)
        && (peer.tier === 'preserved' || (peer.decision === 'adopt' && JSON.parse(String(peer.evidence_json)).sharedMediaConfirmed === evidence.sharedMediaConfirmed))
    })
    if (valid) permissions.set(Number(row.netease_song_id), review.songs.map(song => song.songId))
  }
  return permissions
}
