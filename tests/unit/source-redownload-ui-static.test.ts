import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../..', import.meta.url))
const page = readFileSync(`${root}/components/sources/SyncSourcesPage.vue`, 'utf8')
const detailPage = readFileSync(`${root}/pages/sync-sources/[id].vue`, 'utf8')
const endpoint = readFileSync(`${root}/server/api/playlist-sources/[id]/sync.post.ts`, 'utf8')

describe('source forced redownload UX', () => {
  it('offers the guarded action only in the source detail page', () => {
    expect(page).not.toContain('<SourceOverflowActions')
    expect(detailPage).toContain('重新下载托管音频并同步')
    expect(detailPage).toContain("source.type==='playlist'")
    expect(detailPage).toContain('redownloadPreview?.protectedExternal')
    expect(detailPage).toContain('接管并替换外部文件')
    expect(detailPage).toContain(':confirm-disabled=')
  })

  it('sends a distinct sync mode instead of overloading rebuild matching', () => {
    expect(detailPage).toContain("mode: 'redownload_managed'")
    expect(detailPage).toContain('takeOverExternal: takeOverExternal.value')
    expect(endpoint).toContain('requestSources(')
    expect(endpoint).toContain('...result.results[0]')
    expect(endpoint).not.toContain('startSyncForSource(')
  })
})
