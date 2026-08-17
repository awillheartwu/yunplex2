import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../..', import.meta.url))
const globalEndpoint = readFileSync(`${root}/server/api/sync/trigger.post.ts`, 'utf8')
const sourceEndpoint = readFileSync(`${root}/server/api/playlist-sources/[id]/sync.post.ts`, 'utf8')

describe('sync mode API contract', () => {
  it('accepts only explicit global modes', () => {
    expect(globalEndpoint).toContain('isGlobalSyncMode(mode)')
    expect(globalEndpoint).not.toContain('dryRun?: boolean')
    expect(globalEndpoint).not.toContain('forceFull?: boolean')
  })

  it('uses one mode field for source actions', () => {
    expect(sourceEndpoint).toContain('mode?: SyncMode')
    expect(sourceEndpoint).toContain("mode === 'rebuild_matching'")
    expect(sourceEndpoint).toContain("mode === 'redownload_managed'")
    expect(sourceEndpoint).not.toContain('rebuildMatch?: boolean')
    expect(sourceEndpoint).not.toContain('redownloadAll?: boolean')
  })
})
