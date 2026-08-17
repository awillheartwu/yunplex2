import type { SyncMode } from './service-state'

export interface SyncModePolicy {
  dryRun: boolean
  forceFullCompare: boolean
  rebuildAutomaticBindings: boolean
  redownloadManagedMedia: boolean
}

export function resolveSyncModePolicy(mode: SyncMode): SyncModePolicy {
  return {
    dryRun: mode === 'preview',
    forceFullCompare: mode === 'full' || mode === 'rebuild_matching' || mode === 'redownload_managed',
    rebuildAutomaticBindings: mode === 'rebuild_matching',
    redownloadManagedMedia: mode === 'redownload_managed',
  }
}

export function isGlobalSyncMode(mode: SyncMode): mode is 'normal' | 'preview' | 'full' {
  return mode === 'normal' || mode === 'preview' || mode === 'full'
}
