import type { SourceRequestSnapshot } from '../../lib/sync/source-requests'
import { getDb } from '../../lib/db'
import { fail, success } from '../../lib/response'

export default defineEventHandler(event => {
  const row = getDb().prepare(`SELECT id,source_id AS sourceId,status,request_kind AS kind,run_id AS runId,last_error AS error
    FROM source_sync_queue WHERE id=?`).get(getRouterParam(event, 'id') || '') as SourceRequestSnapshot | undefined
  return row ? success(row) : fail('来源请求不存在或已过保留期')
})
