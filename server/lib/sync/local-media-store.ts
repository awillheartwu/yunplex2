import { existsSync, statSync } from 'node:fs'
import { normalize } from 'node:path'
import type { AppConfig } from '../config/types'
import { getDb } from '../db'
import type { NeteaseSong } from '../netease'
import { findExistingLocalSongPath } from './local-file-discovery'

export type LocalMediaProvenance = 'download_task' | 'legacy_download_task' | 'computed' | 'manual'
export type LocalMediaStatus = 'active' | 'missing' | 'replaced'
export type LocalMediaOwnership = 'managed' | 'external'

export interface LocalMediaAsset {
  neteaseSongId: number
  filePath: string
  provenance: LocalMediaProvenance
  ownership: LocalMediaOwnership
  sourceTaskId: string | null
  status: LocalMediaStatus
  fileSize: number | null
  fileMtimeMs: number | null
  evidence: Record<string, unknown>
  createdAt: string
  updatedAt: string
  lastVerifiedAt: string | null
}

interface LocalMediaRow {
  netease_song_id: number
  file_path: string
  provenance: LocalMediaProvenance
  ownership: LocalMediaOwnership
  source_task_id: string | null
  status: LocalMediaStatus
  file_size: number | null
  file_mtime_ms: number | null
  evidence_json: string
  created_at: string
  updated_at: string
  last_verified_at: string | null
}

function parseEvidence(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw) as Record<string, unknown> } catch { return {} }
}

function fromRow(row: LocalMediaRow): LocalMediaAsset {
  return {
    neteaseSongId: row.netease_song_id,
    filePath: row.file_path,
    provenance: row.provenance,
    ownership: row.ownership,
    sourceTaskId: row.source_task_id,
    status: row.status,
    fileSize: row.file_size,
    fileMtimeMs: row.file_mtime_ms,
    evidence: parseEvidence(row.evidence_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastVerifiedAt: row.last_verified_at,
  }
}

export function getLocalMediaAsset(neteaseSongId: number): LocalMediaAsset | null {
  const row = getDb().prepare('SELECT * FROM local_media_assets WHERE netease_song_id = ?')
    .get(neteaseSongId) as LocalMediaRow | undefined
  return row ? fromRow(row) : null
}

export function upsertLocalMediaAsset(input: {
  neteaseSongId: number
  filePath: string
  provenance: LocalMediaProvenance
  ownership: LocalMediaOwnership
  sourceTaskId?: string | null
  evidence?: Record<string, unknown>
}): LocalMediaAsset {
  const now = new Date().toISOString()
  const filePath = normalize(input.filePath)
  let fileSize: number | null = null
  let fileMtimeMs: number | null = null
  let status: LocalMediaStatus = 'missing'
  try {
    const stat = statSync(filePath)
    if (stat.isFile()) {
      status = 'active'
      fileSize = stat.size
      fileMtimeMs = Math.trunc(stat.mtimeMs)
    }
  } catch { /* persisted as missing until the next verification */ }

  getDb().prepare(`
    INSERT INTO local_media_assets (
      netease_song_id, file_path, provenance, ownership, source_task_id, status,
      file_size, file_mtime_ms, evidence_json, created_at, updated_at, last_verified_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(netease_song_id) DO UPDATE SET
      file_path = excluded.file_path,
      provenance = excluded.provenance,
      ownership = excluded.ownership,
      source_task_id = excluded.source_task_id,
      status = excluded.status,
      file_size = excluded.file_size,
      file_mtime_ms = excluded.file_mtime_ms,
      evidence_json = excluded.evidence_json,
      updated_at = excluded.updated_at,
      last_verified_at = excluded.last_verified_at
  `).run(
    input.neteaseSongId, filePath, input.provenance, input.ownership, input.sourceTaskId ?? null,
    status, fileSize, fileMtimeMs, JSON.stringify(input.evidence ?? {}),
    now, now, now,
  )
  return getLocalMediaAsset(input.neteaseSongId)!
}

export function recordCompletedLocalMediaAsset(input: {
  neteaseSongId: number
  filePath: string
  sourceTaskId: string
  audioDownloaded: boolean
  audioOperation?: 'downloaded' | 'redownloaded' | 'reused'
  sourceId?: string | null
  runId?: string | null
}): LocalMediaAsset {
  const previous = getLocalMediaAsset(input.neteaseSongId)
  const normalizedPath = normalize(input.filePath)
  const reusesManagedAsset = !input.audioDownloaded
    && previous?.ownership === 'managed'
    && normalize(previous.filePath) === normalizedPath
  const ownership: LocalMediaOwnership = input.audioDownloaded || reusesManagedAsset
    ? 'managed'
    : 'external'
  const audioOperation = input.audioDownloaded
    ? input.audioOperation === 'redownloaded' ? 'redownloaded' : 'downloaded'
    : reusesManagedAsset
      ? 'reused_managed'
      : 'adopted_existing'

  return upsertLocalMediaAsset({
    neteaseSongId: input.neteaseSongId,
    filePath: normalizedPath,
    provenance: reusesManagedAsset ? previous!.provenance : 'download_task',
    ownership,
    sourceTaskId: reusesManagedAsset ? previous!.sourceTaskId : input.sourceTaskId,
    evidence: {
      ...(reusesManagedAsset ? previous!.evidence : {}),
      runId: input.runId ?? null,
      sourceId: input.sourceId ?? null,
      lastTaskId: input.sourceTaskId,
      audioOperation,
    },
  })
}

function markMissing(neteaseSongId: number): void {
  getDb().prepare(`UPDATE local_media_assets SET status = 'missing', updated_at = ?, last_verified_at = ? WHERE netease_song_id = ?`)
    .run(new Date().toISOString(), new Date().toISOString(), neteaseSongId)
}

function markReplaced(
  current: LocalMediaAsset,
  observed: { fileSize: number; fileMtimeMs: number },
): LocalMediaAsset {
  const now = new Date().toISOString()
  const evidence = {
    ...current.evidence,
    replacementDetected: true,
    previousFileSize: current.fileSize,
    previousFileMtimeMs: current.fileMtimeMs,
    observedFileSize: observed.fileSize,
    observedFileMtimeMs: observed.fileMtimeMs,
  }
  getDb().prepare(`
    UPDATE local_media_assets
    SET status = 'replaced', evidence_json = ?, updated_at = ?, last_verified_at = ?
    WHERE netease_song_id = ?
  `).run(JSON.stringify(evidence), now, now, current.neteaseSongId)
  return getLocalMediaAsset(current.neteaseSongId)!
}

function adoptLatestSuccessfulDownload(neteaseSongId: number): LocalMediaAsset | null {
  const rows = getDb().prepare(`
    SELECT id, file_path FROM download_tasks
    WHERE song_id = ? AND status = 'done' AND file_path IS NOT NULL AND TRIM(file_path) != ''
    ORDER BY updated_at DESC, created_at DESC
  `).all(neteaseSongId) as Array<{ id: string; file_path: string }>
  const row = rows.find(candidate => existsSync(candidate.file_path))
  if (!row) return null
  return upsertLocalMediaAsset({
    neteaseSongId,
    filePath: row.file_path,
    provenance: 'legacy_download_task',
    ownership: 'managed',
    sourceTaskId: row.id,
    evidence: { recoveredFrom: 'download_tasks' },
  })
}

/**
 * Resolve the strongest locally verifiable media path for a Netease song.
 * Durable provenance wins, then retained download history, then the current
 * naming policy as a compatibility fallback.
 */
export function resolveLocalMediaAsset(song: NeteaseSong, cfg: AppConfig): LocalMediaAsset | null {
  const current = getLocalMediaAsset(song.id)
  if (current && existsSync(current.filePath)) {
    let stat
    try {
      stat = statSync(current.filePath)
    } catch {
      markMissing(song.id)
      return getLocalMediaAsset(song.id)
    }
    if (!stat.isFile()) {
      markMissing(song.id)
      return getLocalMediaAsset(song.id)
    }
    if (
      current.ownership === 'managed'
      && current.status === 'active'
      && current.fileSize !== null
      && current.fileMtimeMs !== null
      && (
        current.fileSize !== stat.size
        || current.fileMtimeMs !== Math.trunc(stat.mtimeMs)
      )
    ) {
      return markReplaced(current, {
        fileSize: stat.size,
        fileMtimeMs: Math.trunc(stat.mtimeMs),
      })
    }
    if (current.status === 'replaced') return current
    return upsertLocalMediaAsset({
      neteaseSongId: song.id,
      filePath: current.filePath,
      provenance: current.provenance,
      ownership: current.ownership,
      sourceTaskId: current.sourceTaskId,
      evidence: current.evidence,
    })
  }
  if (current) markMissing(song.id)

  const recovered = adoptLatestSuccessfulDownload(song.id)
  if (recovered) return recovered

  const computedPath = findExistingLocalSongPath(song, cfg)
  if (!computedPath) return null
  return upsertLocalMediaAsset({
    neteaseSongId: song.id,
    filePath: computedPath,
    provenance: 'computed',
    ownership: 'external',
    evidence: { matchedBy: 'current_path_policy' },
  })
}
