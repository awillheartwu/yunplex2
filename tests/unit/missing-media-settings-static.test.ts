import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
}

describe('missing-media settings wiring', () => {
  it('exposes the global setting and nullable source override in the UI', () => {
    const configPage = source('pages/config.vue')
    const setupPage = source('pages/setup.vue')
    const sourceDialog = source('components/sources/EditSourceDialog.vue')
    const sourceApi = source('server/api/playlist-sources/[id].put.ts')

    expect(configPage).toContain('form.sync.downloadWhenMediaMissing')
    expect(configPage).toContain('缺少已登记媒体时自动下载')
    expect(setupPage).toContain('v-model="config.sync.downloadWhenMediaMissing"')
    expect(setupPage).toContain("config.sync.downloadWhenMediaMissing ? '自动下载' : '继续匹配'")
    expect(setupPage).toContain('初始化只保存选择，不会立即下载')
    expect(sourceDialog).toContain('v-model="form.downloadWhenMediaMissing"')
    expect(sourceDialog).toContain(':global-value="globalSyncSettings.downloadWhenMediaMissing"')
    expect(sourceApi).toContain('downloadWhenMediaMissing?: boolean | null')
    expect(sourceApi).toContain('enablesMissingMediaPolicy(')
  })

  it('keeps preview transient and redownload mode independent', () => {
    const service = source('server/lib/sync/service.ts')
    const plexReconciliation = source('server/lib/sync/source-plex-reconciliation.ts')

    expect(service).toContain("mode !== 'redownload_managed'")
    expect(service).toContain('if (!dryRun) saveSyncRun')
    expect(service).toContain('if (currentRun && !state.dryRun) saveSyncRun')
    expect(service).toContain('missingMediaPolicyEnabled,')
    expect(plexReconciliation).toContain('{ pathOnly: missingMediaPolicyEnabled }')
  })
})
