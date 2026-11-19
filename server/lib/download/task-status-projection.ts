/** A retry needs another sync only when no current convergence owns its continuation. */
export const AWAITING_SOURCE_SYNC_PROJECTION = `CASE WHEN dt.status = 'done'
  AND NOT EXISTS (
    SELECT 1 FROM task_runs active_run
    WHERE active_run.type = 'sync' AND active_run.status = 'running'
      AND (
        active_run.id = COALESCE(dt.run_id, dt.job_id)
        OR EXISTS (SELECT 1 FROM run_file_tasks current_caller
          WHERE current_caller.task_id = dt.id AND current_caller.run_id = active_run.id)
      )
  ) AND (
    ps.requires_match_reconcile = 1
    OR EXISTS (
      SELECT 1 FROM run_file_tasks linked
      JOIN playlist_sources linked_source ON linked_source.id = linked.source_id
      WHERE linked.task_id = dt.id AND linked_source.requires_match_reconcile = 1
    )
  ) THEN 1 ELSE 0 END AS awaiting_source_sync`
