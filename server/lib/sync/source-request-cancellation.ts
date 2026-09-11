import { getDb } from '../db'
import { getRun, saveRun } from '../run/store'
import { cancelSourceInitialization } from '../source-initialization/service'
import { setInitializationStatus } from '../source-initialization/store'

/** Cancel this accepted batch; shared file tasks retain their own lifecycle. */
export function cancelSourceRequests(cancelSync: () => boolean): boolean {
  const db = getDb()
  const current = db.prepare(`SELECT id,batch_id FROM source_sync_queue WHERE status IN ('pending','running')
    ORDER BY CASE status WHEN 'running' THEN 0 ELSE 1 END, created_at,batch_position,rowid LIMIT 1`)
    .get() as { id: string; batch_id: string | null } | undefined
  if (!current) return cancelSync()
  const rows = db.prepare(`SELECT id,source_id,initialization_id,run_id,status FROM source_sync_queue
    WHERE ${current.batch_id ? 'batch_id' : 'id'}=? AND status IN ('pending','running')`)
    .all(current.batch_id ?? current.id) as Array<{ id: string; source_id: string; initialization_id: string | null; run_id: string | null; status: string }>
  const now = new Date().toISOString()
  db.transaction(() => {
    for (const row of rows) {
      if (row.status === 'running') {
        db.prepare('UPDATE source_sync_queue SET cancel_requested_at=? WHERE id=?').run(now, row.id)
        continue
      }
      db.prepare("UPDATE source_sync_queue SET status='cancelled',finished_at=?,updated_at=?,last_error='用户取消' WHERE id=?").run(now, now, row.id)
      if (row.initialization_id) setInitializationStatus(row.initialization_id, 'cancelled', { summary: '用户取消分析' })
      const run = row.run_id ? getRun(row.run_id) : null
      if (run) saveRun({ ...run, status: 'cancelled', finishedAt: now, summary: '用户取消' })
      db.prepare("UPDATE playlist_sources SET last_schedule_status='idle',last_schedule_error=NULL WHERE id=?").run(row.source_id)
    }
  })()
  for (const row of rows) if (row.status === 'running' && row.initialization_id) cancelSourceInitialization(row.source_id)
  cancelSync()
  return true
}
