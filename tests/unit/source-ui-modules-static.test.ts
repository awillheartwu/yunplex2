import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')
const sourcePage = readFileSync(resolve(root, 'components/sources/SyncSourcesPage.vue'), 'utf8')
const sourceActions = readFileSync(resolve(root, 'components/sources/SourceOverflowActions.vue'), 'utf8')
const sourceDetails = readFileSync(resolve(root, 'components/sources/SourceSongDetails.vue'), 'utf8')
const sourceSummary = readFileSync(resolve(root, 'components/sources/SourceSummaryContent.vue'), 'utf8')

describe('sync source UI modules', () => {
  it('shares action semantics across desktop and mobile layouts', () => {
    expect(sourcePage.match(/<SourceOverflowActions/g)?.length).toBe(2)
    expect(sourceActions).toContain('重新评估自动匹配并同步')
    expect(sourceActions).toContain('重新下载托管音频并同步')
    expect(sourceActions).toContain('修复标签、词图')
  })

  it('shares song details and source summaries without external templates', () => {
    expect(sourcePage.match(/<SourceSongDetails/g)?.length).toBe(2)
    expect(sourcePage.match(/<SourceSummaryContent/g)?.length).toBe(2)
    expect(sourceDetails).toContain('failed_plex_insert')
    expect(sourceSummary).toContain('getIssueSummaryLabel')
    expect(sourcePage).not.toContain('<template src=')
  })

  it('keeps page CSS global so extracted child markup receives its BEM styles', () => {
    expect(sourcePage).toContain('<style>')
    expect(sourcePage).not.toContain('<style scoped>')
    expect(sourceActions).toContain('sync-row-menu')
    expect(sourceSummary).toContain('sync-hover-card__cover')
  })
})
