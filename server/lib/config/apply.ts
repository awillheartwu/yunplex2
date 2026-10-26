import type { AppConfig } from './types'
import { readConfig, writeConfig } from './store'
import { getSyncWorker } from '../sync/instance'
import { updatePlexLibraryMonitor } from '../plex-library-monitor'
import { recoverAfterConfigUpdate } from '../download/environment-recovery'
import { appendLog } from '../log/store'
import { getDb } from '../db'
import { listSources, updateSource } from '../playlist/store'
import { sourceConvergenceSettingsKey } from '../sync/effective-settings'

export function applyConfigUpdate(
  patch: unknown,
): { updated: AppConfig; changedKeys: string[] } {
  const previous = readConfig()
  const updated = getDb().transaction(() => {
    const next = writeConfig(patch)
    for (const source of listSources()) {
      if (sourceConvergenceSettingsKey(source, previous) !== sourceConvergenceSettingsKey(source, next)) {
        updateSource(source.id, { requiresMatchReconcile: true })
      }
    }
    return next
  })()
  void recoverAfterConfigUpdate(previous, updated).catch(error => {
    appendLog({ level: 'warn', message: '配置已保存，自动恢复未完成，请检查连接后继续队列', detail: String(error) })
  })
  updatePlexLibraryMonitor()

  const worker = getSyncWorker()
  if (worker) {
    worker.update()
  }

  const changedKeys = getChangedTopLevelKeys(previous, updated, patch)

  return { updated, changedKeys }
}

function getChangedTopLevelKeys(previous: AppConfig, updated: AppConfig, patch: unknown): string[] {
  const patchKeys = patch && typeof patch === 'object' && !Array.isArray(patch)
    ? Object.keys(patch as Record<string, unknown>)
    : Object.keys(updated)

  const updatedRecord = updated as unknown as Record<string, unknown>
  const previousRecord = previous as unknown as Record<string, unknown>

  return patchKeys.filter((key) =>
    JSON.stringify(updatedRecord[key]) !== JSON.stringify(previousRecord[key]),
  )
}
