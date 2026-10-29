import { createHash } from 'node:crypto'
import { getDb, readConfigFromDb } from '../db'
import type { AppConfig } from '../config/types'
import type { PlaylistSource } from '../playlist/types'
import { getSource, updateSource } from '../playlist/store'
import { sourceConvergenceSettingsKey } from './effective-settings'
import { assertPlexClientConfig } from '../plex-client'
import type { DomainErrorCode } from '../../../shared/domain-errors'

export interface PlaylistWriteItem {
  ratingKey: string
  playlistItemId: number
  filePaths?: string[]
}

/** One in-flight boundary per source, not an operation history. Survives loss of the HTTP response. */
export interface PendingPlaylistWrite {
  kind: 'create' | 'insert' | 'move' | 'remove'
  playlistKey: string
  scope: string
  before: PlaylistWriteItem[]
  expected: PlaylistWriteItem[]
  ratingKeys: string[]
  submitted: number
  acknowledged: boolean
  prefixHashes?: string[]
  sourceSettingsKey?: string
  startedAt: string
}

const stateKey = (sourceId: string) => `plex-playlist-write:${sourceId}`
export function playlistServerScope(config: AppConfig): string {
  return createHash('sha256').update(JSON.stringify([config.plex.server, config.plex.port, config.plex.section])).digest('hex')
}
export function pendingPlaylistWrite(sourceId: string): PendingPlaylistWrite | null {
  const row = getDb().prepare('SELECT value FROM app_state WHERE key=?').get(stateKey(sourceId)) as { value: string } | undefined
  if (!row) return null
  try { return JSON.parse(row.value) as PendingPlaylistWrite }
  catch { throw playlistWriteError('未确认的 Plex 写入状态无法读取，请核对目标后重新指定歌单') }
}
export function savePendingPlaylistWrite(sourceId: string, state: PendingPlaylistWrite): void {
  getDb().transaction(() => {
    getDb().prepare('INSERT INTO app_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(stateKey(sourceId), JSON.stringify(state))
    updateSource(sourceId, { requiresMatchReconcile: true })
  })()
}
export function clearPendingPlaylistWrite(sourceId: string): void {
  getDb().prepare('DELETE FROM app_state WHERE key=?').run(stateKey(sourceId))
}
export function playlistWriteNotice(sourceId: string): import('../../../shared/playlist-write').PlaylistWriteNotice | null {
  const state = pendingPlaylistWrite(sourceId)
  return state ? { kind: state.kind, playlistKey: state.playlistKey, startedAt: state.startedAt } : null
}
export function playlistWriteError(message: string, code: DomainErrorCode = 'plex_write_uncertain', cause?: unknown): Error & { code: DomainErrorCode } {
  return Object.assign(new Error(message, cause ? { cause } : undefined), { code })
}

/** Rechecked after every network wait and before every write; status/timestamps are not configuration. */
export function assertPlaylistWriteContext(source: PlaylistSource, config: AppConfig): void {
  assertPlexClientConfig(config.plex)
  const current = getSource(source.id)
  const latest = readConfigFromDb()
  if (!current || current.enabled !== source.enabled || latest.sync.enabled !== config.sync.enabled
    || latest.plex.token !== config.plex.token
    || sourceConvergenceSettingsKey(current, latest) !== sourceConvergenceSettingsKey(source, config)) {
    throw playlistWriteError('来源目标或有效配置已变化，本轮停止继续写入 Plex，请重新同步', 'concurrent_operation')
  }
}

export function writeRequestDefinitelyEnded(error: unknown): boolean {
  const status = (error as { httpStatus?: number } | null)?.httpStatus
  return status !== undefined && [400, 401, 403, 404, 413, 414, 422].includes(status)
}

/** Only the existing explicit target-setting command may release an unprovable boundary. */
export function acknowledgePlaylistTargetSelection(sourceId: string, playlistKey: string): void {
  if (!playlistKey) return
  const active = getDb().prepare("SELECT 1 FROM source_sync_queue WHERE source_id=? AND status='running'").get(sourceId)
  if (active) {
    throw playlistWriteError('该来源仍在运行，请先取消并等待结束，再明确指定 Plex 目标')
  }
  clearPendingPlaylistWrite(sourceId)
}
