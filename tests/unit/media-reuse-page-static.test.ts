import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../..', import.meta.url))
const page = readFileSync(`${root}/pages/match-reviews.vue`, 'utf8')
const sourceMedia = readFileSync(`${root}/components/sources/SourceMediaDetails.vue`, 'utf8')
const sourcePage = readFileSync(`${root}/components/sources/SyncSourcesPage.vue`, 'utf8')
const sourceDetailPage = readFileSync(`${root}/pages/sync-sources/[id].vue`, 'utf8')
const sidebar = readFileSync(`${root}/components/layout/Sidebar.vue`, 'utf8')

describe('media reuse page contract', () => {
  it('moves everyday media management into source context', () => {
    expect(sourcePage).not.toContain('<SourceMediaDetails')
    expect(sourceDetailPage).toContain("activeTab==='media'")
    expect(sourceDetailPage).toContain('<SourceMediaDetails')
    expect(sourceMedia).toContain('歌曲与媒体')
    expect(sourceMedia).toContain('使用 Plex 媒体')
    expect(sourceMedia).toContain('下载并托管')
    expect(sourceMedia).toContain('取消使用')
    expect(sourceMedia).toContain('这不是当前歌单的局部设置')
    expect(sourceMedia).toContain("orphaned || item.binding.bindingMethod === 'manual'")
    expect(sourceMedia).toContain("if (search.value.trim()) params.search")
    expect(sourceMedia).not.toContain('search: search.value.trim() || undefined')
  })

  it('keeps only a weak advanced entry for orphaned bindings', () => {
    expect(page).toContain('高级媒体关联')
    expect(page).toContain('source-id="orphaned"')
    expect(page).toContain('返回同步源')
    expect(sidebar).not.toContain("path: '/match-reviews'")
  })
})
