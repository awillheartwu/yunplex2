import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEPENDENCY_HEALTH_TTL_MS,
  getDependencyHealthSnapshot,
  getSystemHealthSnapshot,
  resetSystemHealthCacheForTest,
  setSystemHealthCheckersForTest,
} from '../../server/lib/system-health'

describe('system dependency health cache', () => {
  afterEach(() => { resetSystemHealthCacheForTest(); vi.restoreAllMocks() })

  it('serves exact bytes and compatible rounded MiB from the same sample', async () => {
    const bytes = { rss: 983302144, heapUsed: 41943127, heapTotal: 47185999, external: 3145749, arrayBuffers: 65539 }
    const read = vi.spyOn(process, 'memoryUsage').mockReturnValue(bytes)
    setSystemHealthCheckersForTest({ plex: async () => false, netease: async () => false, dirWritable: () => true })

    const snapshot = await getSystemHealthSnapshot()

    expect(snapshot.memory).toEqual(bytes)
    expect(snapshot.mem).toEqual({ rss: 938, heapUsed: 40, heapTotal: 45, external: 3, arrayBuffers: 0 })
    expect(snapshot.memoryContext).toMatchObject({ rssScope: 'process', detailsScope: 'thread' })
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('caches dependency checks for the TTL and supports force refresh', async () => {
    let plexChecks = 0
    let neteaseChecks = 0
    let dirChecks = 0
    setSystemHealthCheckersForTest({
      plex: async () => { plexChecks += 1; return true },
      netease: async () => { neteaseChecks += 1; return true },
      dirWritable: () => { dirChecks += 1; return true },
    })

    const first = await getDependencyHealthSnapshot({ now: 1_000 })
    const cached = await getDependencyHealthSnapshot({ now: 2_000 })
    const forced = await getDependencyHealthSnapshot({ force: true, now: 3_000 })
    const expired = await getDependencyHealthSnapshot({ now: 3_000 + DEPENDENCY_HEALTH_TTL_MS + 1 })

    expect(first.dependencyCheckedAt).toBe(1_000)
    expect(cached.dependencyCheckedAt).toBe(1_000)
    expect(forced.dependencyCheckedAt).toBe(3_000)
    expect(expired.dependencyCheckedAt).toBe(3_000 + DEPENDENCY_HEALTH_TTL_MS + 1)
    expect({ plexChecks, neteaseChecks, dirChecks }).toEqual({ plexChecks: 3, neteaseChecks: 3, dirChecks: 3 })
  })
})
