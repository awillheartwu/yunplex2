import type { AppConfig } from './types'
import { readConfig, writeConfig } from './store'
import { recordActivityEvent } from '../activity/store'
import { getSyncWorker } from '../sync/instance'

interface ApplyConfigUpdateOptions {
  title: string
  type: string
  summaryWhenChanged: (changedKeys: string[]) => string
  summaryWhenUnchanged: string
  groupKey: string
}

export function applyConfigUpdate(
  patch: unknown,
  options: ApplyConfigUpdateOptions,
): { updated: AppConfig; changedKeys: string[] } {
  const previous = readConfig()
  const updated = writeConfig(patch)

  const worker = getSyncWorker()
  if (worker) {
    worker.update()
  }

  const changedKeys = getChangedTopLevelKeys(previous, updated, patch)

  recordActivityEvent({
    domain: 'user',
    type: options.type,
    severity: 'info',
    actor: 'user',
    title: options.title,
    summary: changedKeys.length > 0
      ? options.summaryWhenChanged(changedKeys)
      : options.summaryWhenUnchanged,
    context: { changedKeys },
    link: '/config',
    groupKey: options.groupKey,
  })

  return { updated, changedKeys }
}

function getChangedTopLevelKeys(previous: AppConfig, updated: AppConfig, patch: unknown): string[] {
  const patchKeys = patch && typeof patch === 'object' && !Array.isArray(patch)
    ? Object.keys(patch as Record<string, unknown>)
    : Object.keys(updated)

  return patchKeys.filter((key) =>
    JSON.stringify((updated as Record<string, unknown>)[key]) !==
    JSON.stringify((previous as Record<string, unknown>)[key]),
  )
}
