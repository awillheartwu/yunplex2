import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../..', import.meta.url))
const page = readFileSync(`${root}/pages/match-reviews.vue`, 'utf8')
const overview = readFileSync(`${root}/components/match-management/OverviewTab.vue`, 'utf8')

describe('media reuse page contract', () => {
  it('presents the three safe identity rules without a review queue or history tab', () => {
    expect(page).toContain('托管文件自动复用')
    expect(page).toContain('外部媒体明确接管')
    expect(page).toContain('无法确认就下载')
    expect(page).not.toContain('ReviewQueueTab')
    expect(page).not.toContain('IdentityHistoryTab')
  })

  it('keeps explicit adoption and cancellation available', () => {
    expect(overview).toContain('接管媒体')
    expect(overview).toContain('取消接管')
  })
})
