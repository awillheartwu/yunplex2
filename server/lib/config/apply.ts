import type { AppConfig } from './types'
import { readConfig, writeConfig } from './store'
import { getSyncWorker } from '../sync/instance'
import { markInheritedMissingMediaSourcesForReconcile } from '../playlist/store'

export function applyConfigUpdate(
  patch: unknown,
): { updated: AppConfig; changedKeys: string[] } {
  const previous = readConfig()
  const updated = writeConfig(patch)

  if (!previous.sync.downloadWhenMediaMissing && updated.sync.downloadWhenMediaMissing) {
    markInheritedMissingMediaSourcesForReconcile()
  }

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
