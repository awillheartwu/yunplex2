import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../..', import.meta.url))
const page = readFileSync(`${root}/components/sources/SyncSourcesPage.vue`, 'utf8')
const sourceActions = readFileSync(`${root}/components/sources/SourceOverflowActions.vue`, 'utf8')
const composable = readFileSync(`${root}/composables/useSyncSourcesPage.ts`, 'utf8')
const endpoint = readFileSync(`${root}/server/api/playlist-sources/[id]/sync.post.ts`, 'utf8')

describe('source forced redownload UX', () => {
  it('offers the guarded action in desktop and mobile menus', () => {
    expect(page.match(/<SourceOverflowActions/g)?.length).toBe(2)
    expect(sourceActions).toContain('重新下载托管音频并同步')
    expect(sourceActions).toContain("source.type === 'playlist'")
    expect(page).toContain('redownloadPreview.protectedExternal')
    expect(page).toContain('接管并替换外部文件')
    expect(page).toContain(':confirm-disabled=')
  })

  it('sends a distinct sync mode instead of overloading rebuild matching', () => {
    expect(composable).toContain("mode: 'redownload_managed'")
    expect(composable).toContain('takeOverExternal: takeOverExternal.value')
    expect(endpoint).toContain("mode === 'redownload_managed'")
    expect(endpoint).toContain('source_redownload_sync_triggered')
  })
})
