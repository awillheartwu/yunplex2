import { existsSync, statSync } from 'node:fs'
import { normalize } from 'node:path'
import type { AppConfig } from '../config/types'
import { getDb } from '../db'
import { parseJsonObject } from '../json'
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

export type LocalMediaInspectionState =
  | 'active_managed'
  | 'active_external'
  | 'missing'
  | 'replaced'
  | 'unregistered_managed'
  | 'unregistered_external'

export interface LocalMediaInspection {
  neteaseSongId: number
  state: LocalMediaInspectionState
  asset: LocalMediaAsset | null
  filePath: string | null
  discovery: {
    provenance: LocalMediaProvenance
    ownership: LocalMediaOwnership
    sourceTaskId: string | null
    evidence: Record<string, unknown>
  } | null
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
    evidence: parseJsonObject(row.evidence_json),
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

export function getLocalMediaAssets(neteaseSongIds: readonly number[]): Map<number, LocalMediaAsset> {
  const ids = [...new Set(neteaseSongIds)]
  if (ids.length === 0) return new Map()
  const rows = getDb().prepare(`
    SELECT * FROM local_media_assets
    WHERE netease_song_id IN (${ids.map(() => '?').join(', ')})
  `).all(...ids) as LocalMediaRow[]
  return new Map(rows.map(row => [row.netease_song_id, fromRow(row)]))
}

/**
 * Inspect media without changing durable state. Preview and change detection
 * must be able to use this function without repairing or rewriting records.
 */
export function inspectLocalMediaAssets(
  songs: readonly NeteaseSong[],
  cfg: AppConfig,
): Map<number, LocalMediaInspection> {
  const songIds = [...new Set(songs.map(song => song.id))]
  const assets = getLocalMediaAssets(songIds)
  const retainedTasks = getLatestExistingDownloadTasks(songIds)
  const result = new Map<number, LocalMediaInspection>()

  for (const song of songs) {
    if (result.has(song.id)) continue
    const asset = assets.get(song.id) ?? null
    if (asset) {
      const stat = safeFileStat(asset.filePath)
      if (!stat) {
        result.set(song.id, inspection(song.id, asset.status === 'replaced' ? 'replaced' : 'missing', asset, asset.filePath))
        continue
      }
      if (asset.status !== 'active') {
        result.set(song.id, inspection(song.id, asset.status, asset, asset.filePath))
        continue
      }
      const replaced = asset.ownership === 'managed'
        && asset.fileSize !== null
        && asset.fileMtimeMs !== null
        && (asset.fileSize !== stat.size || asset.fileMtimeMs !== Math.trunc(stat.mtimeMs))
      result.set(song.id, inspection(
        song.id,
        replaced ? 'replaced' : asset.ownership === 'managed' ? 'active_managed' : 'active_external',
        asset,
        asset.filePath,
      ))
      continue
    }

    const retained = retainedTasks.get(song.id)
    if (retained) {
      result.set(song.id, {
        ...inspection(song.id, 'unregistered_managed', null, retained.filePath),
        discovery: {
          provenance: 'legacy_download_task',
          ownership: 'managed',
          sourceTaskId: retained.id,
          evidence: { recoveredFrom: 'download_tasks' },
        },
      })
      continue
    }

    const computedPath = findExistingLocalSongPath(song, cfg)
    result.set(song.id, computedPath
      ? {
          ...inspection(song.id, 'unregistered_external', null, computedPath),
          discovery: {
            provenance: 'computed',
            ownership: 'external',
            sourceTaskId: null,
            evidence: { matchedBy: 'current_path_policy' },
          },
        }
      : inspection(song.id, 'missing', null, null))
  }
  return result
}

export function persistLocalMediaInspection(item: LocalMediaInspection): LocalMediaAsset | null {
  if (item.discovery && item.filePath) {
    return upsertLocalMediaAsset({
      neteaseSongId: item.neteaseSongId,
      filePath: item.filePath,
      ...item.discovery,
    })
  }
  if (item.asset && item.state === 'missing') {
    markMissing(item.neteaseSongId)
    return getLocalMediaAsset(item.neteaseSongId)
  }
  if (item.asset && item.state === 'replaced') {
    const stat = safeFileStat(item.asset.filePath)
    if (stat) return markReplaced(item.asset, stat)
    markMissing(item.neteaseSongId)
    return getLocalMediaAsset(item.neteaseSongId)
  }
  if (item.asset && (item.state === 'active_managed' || item.state === 'active_external')) {
    return upsertLocalMediaAsset({
      neteaseSongId: item.asset.neteaseSongId,
      filePath: item.asset.filePath,
      provenance: item.asset.provenance,
      ownership: item.asset.ownership,
      sourceTaskId: item.asset.sourceTaskId,
      evidence: item.asset.evidence,
    })
  }
  return item.asset
}

function inspection(
  neteaseSongId: number,
  state: LocalMediaInspectionState,
  asset: LocalMediaAsset | null,
  filePath: string | null,
): LocalMediaInspection {
  return { neteaseSongId, state, asset, filePath, discovery: null }
}

function safeFileStat(filePath: string): { fileSize: number; fileMtimeMs: number; size: number; mtimeMs: number } | null {
  try {
    const stat = statSync(filePath)
    if (!stat.isFile()) return null
    return {
      fileSize: stat.size,
      fileMtimeMs: Math.trunc(stat.mtimeMs),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    }
  } catch {
    return null
  }
}

function getLatestExistingDownloadTasks(
  neteaseSongIds: readonly number[],
): Map<number, { id: string; filePath: string }> {
  if (neteaseSongIds.length === 0) return new Map()
  const rows = getDb().prepare(`
    SELECT song_id, id, file_path
    FROM download_tasks
    WHERE song_id IN (${neteaseSongIds.map(() => '?').join(', ')})
      AND status = 'done' AND file_path IS NOT NULL AND TRIM(file_path) != ''
    ORDER BY song_id, updated_at DESC, created_at DESC
  `).all(...neteaseSongIds) as Array<{ song_id: number; id: string; file_path: string }>
  const result = new Map<number, { id: string; filePath: string }>()
  for (const row of rows) {
    if (!result.has(row.song_id) && existsSync(row.file_path)) {
      result.set(row.song_id, { id: row.id, filePath: row.file_path })
    }
  }
  return result
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
