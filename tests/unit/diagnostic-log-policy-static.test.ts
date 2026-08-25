import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), 'utf8')

describe('diagnostic log policy', () => {
  it('keeps Source Convergence results out of persistent logs', () => {
    const source = [
      'server/lib/sync/service.ts',
      'server/lib/sync/source-downloads.ts',
      'server/lib/sync/source-finalization.ts',
      'server/lib/sync/source-plex-reconciliation.ts',
      'server/lib/sync/reorder.ts',
    ].map(read).join('\n')

    expect(source).not.toContain("log('info'")
    expect(source).not.toContain('Plex 未找到:')
    expect(source).toContain("log('warn'")
    expect(source).toContain("log('error'")
  })

  it('uses automatic lifecycle maintenance instead of manual destructive cleanup', () => {
    expect(existsSync(join(root, 'server/api/logs.delete.ts'))).toBe(false)
    expect(read('composables/useSystemLogs.ts')).not.toContain("value: 'debug'")
    expect(read('server/lib/log/store.ts')).not.toContain('DELETE FROM logs')
    expect(read('server/lib/maintenance/data-lifecycle.ts')).toContain('DELETE FROM logs')
  })
})
