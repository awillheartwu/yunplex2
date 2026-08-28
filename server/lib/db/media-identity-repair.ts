import type Database from 'better-sqlite3'
import { normalizePlexPath, normalizePlexRelativePath } from '../sync/identity-normalization'
import { tableExists } from './introspection'

function configuredPlexSectionRoot(d: Database.Database): string {
  if (!tableExists(d, 'config')) return ''
  const row = d.prepare("SELECT value FROM config WHERE key = 'app'").get() as { value: string } | undefined
  if (!row) return ''
  try {
    const config = JSON.parse(row.value) as { download?: { plexLibraryPathPrefix?: unknown } }
    return typeof config.download?.plexLibraryPathPrefix === 'string'
      ? normalizePlexPath(config.download.plexLibraryPathPrefix)
      : ''
  } catch {
    return ''
  }
}

function deleteFailureRecords(d: Database.Database, ids: readonly string[]): void {
  if (ids.length === 0) return
  const fingerprints = d.prepare(`
    SELECT fingerprint FROM failure_records
    WHERE id IN (${ids.map(() => '?').join(', ')})
  `).all(...ids) as Array<{ fingerprint: string }>
  if (fingerprints.length > 0 && tableExists(d, 'failure_occurrences')) {
    d.prepare(`DELETE FROM failure_occurrences WHERE fingerprint IN (${fingerprints.map(() => '?').join(', ')})`)
      .run(...fingerprints.map(row => row.fingerprint))
  }
  d.prepare(`DELETE FROM failure_records WHERE id IN (${ids.map(() => '?').join(', ')})`).run(...ids)
}

/** Repair identities and failure rows produced by older path/lifecycle logic. */
export function repairMediaIdentityData(d: Database.Database): void {
  d.transaction(() => {
    if (tableExists(d, 'song_identity_bindings')) {
      const sectionRoot = configuredPlexSectionRoot(d)
      if (sectionRoot) {
        const rows = d.prepare(`
          SELECT netease_song_id, plex_file_path, plex_relative_path
          FROM song_identity_bindings
          WHERE status != 'unbound'
        `).all() as Array<{
          netease_song_id: number
          plex_file_path: string
          plex_relative_path: string
        }>
        const update = d.prepare(`
          UPDATE song_identity_bindings SET plex_relative_path = ?
          WHERE netease_song_id = ?
        `)
        for (const row of rows) {
          const canonical = normalizePlexRelativePath(row.plex_file_path, sectionRoot)
          if (canonical !== row.plex_relative_path) update.run(canonical, row.netease_song_id)
        }
      }
    }

    if (!tableExists(d, 'failure_records')) return
    const obsolete = d.prepare(`
      SELECT failure.id
      FROM failure_records failure
      LEFT JOIN playlist_sources source ON source.id = failure.source_id
      WHERE failure.source_id IS NOT NULL
        AND (source.id IS NULL OR failure.song_id IS NULL)
    `).all() as Array<{ id: string }>
    deleteFailureRecords(d, obsolete.map(row => row.id))

    const now = new Date().toISOString()
    d.prepare(`
      UPDATE failure_records AS previous
      SET status = 'resolved', resolved_at = ?, ignored_at = NULL
      WHERE previous.status = 'open'
        AND previous.failure_kind != 'copyright_restricted'
        AND previous.song_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM failure_records copyright
          WHERE copyright.status = 'open'
            AND copyright.failure_kind = 'copyright_restricted'
            AND copyright.song_id = previous.song_id
            AND copyright.source_id IS previous.source_id
        )
    `).run(now)
  })()
}
