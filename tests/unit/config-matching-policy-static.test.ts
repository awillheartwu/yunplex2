import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../..', import.meta.url))
const page = readFileSync(`${root}/pages/config.vue`, 'utf8')

describe('matching policy settings UX', () => {
  it('exposes the high-confidence policy as an explicit conditional setting', () => {
    expect(page).toContain('v-model="form.sync.enableHighConfidenceMetadataBinding"')
    expect(page).toContain('v-if="form.sync.enableHighConfidenceMetadataBinding"')
    expect(page).toContain('v-model.number="form.sync.metadataDurationToleranceSec"')
    expect(page).toContain('不会覆盖冲突的 MB recording')
  })

  it('announces that matching-policy changes require a rebuilt match', () => {
    expect(page).toContain('matchingPolicyChanged')
    expect(page).toContain('重建匹配并同步')
  })
})
