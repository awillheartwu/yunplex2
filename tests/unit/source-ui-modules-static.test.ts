import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')
const sourcePage = readFileSync(resolve(root, 'components/sources/SyncSourcesPage.vue'), 'utf8')
const sourceDetailPage = readFileSync(resolve(root, 'pages/sync-sources/[id].vue'), 'utf8')
const sourceDetails = readFileSync(resolve(root, 'components/sources/SourceMediaDetails.vue'), 'utf8')
const sourceSummary = readFileSync(resolve(root, 'components/sources/SourceSummaryContent.vue'), 'utf8')
const sourceInitialization = readFileSync(resolve(root, 'components/sources/SourceInitializationPanel.vue'), 'utf8')

describe('sync source UI modules', () => {
  it('keeps the source list lightweight and moves advanced actions into detail', () => {
    expect(sourcePage).not.toContain('<SourceOverflowActions')
    expect(sourcePage).toContain('<LibraryCollection')
    expect(sourceDetailPage).toContain("sync('rebuild_matching')")
    expect(sourceDetailPage).toContain('重新下载托管媒体')
    expect(sourceDetailPage).toContain('重新评估自动匹配并同步')
    expect(sourceDetailPage).toContain('重新下载托管音频并同步')
    expect(sourceDetailPage).toContain('@click="repair"')
    expect(sourceDetailPage).toContain('<SourceSettingsPanel')
  })

  it('shares song details and source summaries without external templates', () => {
    expect(sourcePage).not.toContain('<SourceMediaDetails')
    expect(sourceDetailPage).toContain('<SourceMediaDetails')
    expect(sourceDetailPage).toContain('<SourceSummaryContent')
    expect(sourceDetails).toContain('/match-management/overview')
    expect(sourceDetails).toContain('/match-management/validate')
    expect(sourceDetails).toContain('/match-management/plex-search')
    expect(sourceSummary).toContain('getIssueSummaryLabel')
    expect(sourcePage).not.toContain('<template src=')
  })

  it('keeps page CSS global so extracted child markup receives its BEM styles', () => {
    expect(sourcePage).toContain('<style>')
    expect(sourcePage).not.toContain('<style scoped>')
    expect(sourceSummary).toContain('sync-hover-card__cover')
  })

  it('lets an awaiting-review initialization be safely discarded and reanalyzed', () => {
    expect(sourceInitialization).toContain('放弃方案并重新分析')
    expect(sourceInitialization).toContain('confirmReanalysis')
    const controller = readFileSync(`${root}/composables/useSourceInitialization.ts`, 'utf8')
    expect(controller).toContain('/initialization/restart')
    expect(controller).toContain('initializationId')
    expect(sourceInitialization).toContain('useSourceInitialization')
  })
})
