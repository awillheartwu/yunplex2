import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
}

describe('automatic media fallback wiring', () => {
  it('does not expose the retired missing-media choice', () => {
    expect(source('pages/config.vue')).not.toContain('form.sync.downloadWhenMediaMissing')
    expect(source('pages/setup.vue')).not.toContain('v-model="config.sync.downloadWhenMediaMissing"')
    expect(source('components/sources/EditSourceDialog.vue')).not.toContain('form.downloadWhenMediaMissing')
  })

  it('always uses exact-path retry and automatic fallback during normal sync', () => {
    expect(source('server/lib/sync/service.ts')).toContain("const missingMediaPolicyEnabled = mode !== 'redownload_managed'")
    expect(source('server/lib/sync/source-plex-reconciliation.ts')).toContain('{ pathOnly: true }')
  })
})
