import { getDb } from '../db'
import { parseJsonObject } from '../json'
import { isFileTaskSupersededByManualBinding } from '../download/intent-identity'

export type CompletionEvidence = 'file' | 'identity' | 'playlist' | 'source' | 'details' | 'superseded'

interface FileIntent {
  id: string
  status: string
  song_id: number
  operation: string
  quality: string | null
  file_path: string | null
  target_path: string | null
  idempotency_key: string | null
  execution_intent_json: string | null
  updated_at: string
  created_at: string
}

/** A file's existence cannot prove that a requested replacement or tag edit ran. */
export function hasCompletionEvidence(input: {
  downloadTaskIds: string[]
  failureKind: string
  lastSeenAt: string
  evidence: CompletionEvidence
  downloadTaskId?: string
}): boolean {
  if (!input.downloadTaskIds.length) return input.evidence !== 'file'
  if (input.evidence === 'superseded') return input.downloadTaskIds.every(id => {
    const original = getDb().prepare('SELECT * FROM download_tasks WHERE id=?').get(id) as FileIntent | undefined
    return original && (original.status === 'done' || isFileTaskSupersededByManualBinding({
      songId: original.song_id, createdAt: original.created_at,
      executionIntent: parseJsonObject(original.execution_intent_json),
    }))
  })
  if (input.evidence !== 'file' || !input.downloadTaskId) return false
  const db = getDb()
  const completed = db.prepare("SELECT * FROM download_tasks WHERE id = ? AND status = 'done'").get(input.downloadTaskId) as FileIntent | undefined
  if (!completed) return false
  return input.downloadTaskIds.every(id => {
    const original = db.prepare('SELECT * FROM download_tasks WHERE id = ?').get(id) as FileIntent | undefined
    if (!original) return false
    if (original.status === 'done') return true
    if (original.song_id !== completed.song_id || completed.updated_at < input.lastSeenAt) return false
    const sameOutput = (original.idempotency_key && original.idempotency_key === completed.idempotency_key)
      || (completed.file_path && completed.file_path === (original.file_path ?? original.target_path))
    if (!sameOutput) return false
    const intent = parseJsonObject(original.execution_intent_json)
    const doneIntent = parseJsonObject(completed.execution_intent_json)
    if (original.operation !== 'repair_existing' && original.quality && original.quality !== completed.quality) return false
    if (original.operation === 'replace' || intent.downloadMode === 'replace') {
      if (completed.operation !== 'replace' && doneIntent.downloadMode !== 'replace') return false
    }
    if (original.operation === 'repair_existing' || intent.embedMetadata === true || input.failureKind === 'failed_tags') {
      if (doneIntent.embedMetadata !== true) return false
      if (intent.multiArtistFormat !== undefined && intent.multiArtistFormat !== doneIntent.multiArtistFormat) return false
      if (intent.applyAliasToAlbum !== undefined && intent.applyAliasToAlbum !== doneIntent.applyAliasToAlbum) return false
      if (intent.artistAliases !== undefined && JSON.stringify(intent.artistAliases) !== JSON.stringify(doneIntent.artistAliases)) return false
    }
    for (const option of ['embedCover', 'saveAlbumCover', 'saveArtistImage'] as const) {
      if (intent[option] === true && doneIntent[option] !== true) return false
    }
    if (intent.downloadLyrics === true) {
      if (doneIntent.downloadLyrics !== true) return false
      for (const option of ['lyricOrder', 'downloadTranslatedLyric', 'downloadRomajiLyric'] as const) {
        if (intent[option] !== undefined && intent[option] !== doneIntent[option]) return false
      }
    }
    return true
  })
}
