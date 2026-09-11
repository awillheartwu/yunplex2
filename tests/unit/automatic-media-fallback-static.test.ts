import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
}

describe('automatic media fallback wiring', () => {
  it('exposes only the new unverified-media policy', () => {
    expect(source('pages/config.vue')).toContain('form.sync.unverifiedMediaPolicy')
    expect(source('pages/config.vue')).toContain('自动下载并托管')
    expect(source('pages/config.vue')).toContain('等待手动选择')
    expect(source('pages/config.vue')).not.toContain('form.sync.downloadWhenMediaMissing')
    expect(source('pages/setup.vue')).not.toContain('v-model="config.sync.downloadWhenMediaMissing"')
    expect(source('components/sources/SourceSettingsPanel.vue')).not.toContain('form.downloadWhenMediaMissing')
  })

  it('offers both explicit per-song resolutions in source context', () => {
    const details = source('components/sources/SourceMediaDetails.vue')
    expect(details).toContain('使用 Plex 媒体')
    expect(details).toContain('下载并托管')
    expect(details).toContain('/download-managed')
  })

  it('always uses exact-path retry and automatic fallback during normal sync', () => {
    expect(source('server/lib/sync/service.ts')).toContain("const missingMediaPolicyEnabled = mode !== 'redownload_managed'")
    expect(source('server/lib/sync/source-plex-reconciliation.ts')).toContain('{ pathOnly: true }')
  })
})
