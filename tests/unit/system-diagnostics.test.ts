import { describe, expect, it } from 'vitest'
import { buildSystemDiagnosticReport } from '../../lib/system-diagnostics'
import { MEBIBYTE } from '../../shared/system-memory'

describe('system diagnostics report', () => {
  it('uses a whitelist and excludes sensitive input fields', () => {
    const report = buildSystemDiagnosticReport({
      generatedAt: new Date('2026-06-30T00:00:00.000Z'),
      info: {
        version: '0.1.0',
        platform: 'macOS',
        nodeVersion: 'v24.14.1',
        docker: false,
        token: 'secret',
      } as never,
      stats: {
        cpu: 12,
        mem: { rss: 100, heapUsed: 40, heapTotal: 80, external: 5 },
        memory: { rss: 100.25 * MEBIBYTE, heapUsed: 40 * MEBIBYTE, heapTotal: 80 * MEBIBYTE, external: 5 * MEBIBYTE, arrayBuffers: 1536, token: 'secret' },
        memoryContext: { mode: 'development', rssScope: 'process', detailsScope: 'thread', isMainThread: false, threadId: 2, cookie: 'secret' },
        uptime: 9,
        pid: 123,
        dbSize: 1.2,
        dbStats: { task_runs: 2 },
        plexOk: true,
        neteaseOk: false,
        dirWritable: true,
        dependencyCheckedAt: Date.parse('2026-06-30T00:00:00.000Z'),
        dependencyCacheTtlMs: 60000,
        cookie: 'secret',
      } as never,
    })
    const serialized = JSON.stringify(report)

    expect(report).toMatchObject({
      generatedAt: '2026-06-30T00:00:00.000Z',
      app: { version: '0.1.0', platform: 'macOS', nodeVersion: 'v24.14.1', docker: false },
      health: { plexOk: true, neteaseOk: false, dirWritable: true },
      resources: {
        memoryUnit: 'MiB',
        memoryMb: { rss: 100.25, heapUsed: 40, heapTotal: 80, external: 5, arrayBuffers: 1536 / MEBIBYTE },
        memoryBytes: { rss: 100.25 * MEBIBYTE, heapUsed: 40 * MEBIBYTE, heapTotal: 80 * MEBIBYTE, external: 5 * MEBIBYTE, arrayBuffers: 1536 },
        memoryContext: { mode: 'development', rssScope: 'process', detailsScope: 'thread', isMainThread: false, threadId: 2 },
      },
      tables: { task_runs: 2 },
    })
    expect(serialized).not.toContain('secret')
    expect(serialized).not.toContain('token')
    expect(serialized).not.toContain('cookie')
  })

  it('keeps old reports compatible and marks unmeasured byte values and context as unknown', () => {
    const resources = buildSystemDiagnosticReport({ stats: { mem: { rss: 100, external: 0 } } }).resources
    expect(resources.memoryMb).toEqual({ rss: 100, heapUsed: null, heapTotal: null, external: 0, arrayBuffers: null })
    expect(resources.memoryBytes).toEqual({ rss: null, heapUsed: null, heapTotal: null, external: null, arrayBuffers: null })
    expect(resources.memoryContext).toBeNull()
  })
})
