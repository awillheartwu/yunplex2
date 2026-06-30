import { describe, expect, it } from 'vitest'
import { buildSystemDiagnosticReport } from '../../lib/system-diagnostics'

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
      tables: { task_runs: 2 },
    })
    expect(serialized).not.toContain('secret')
    expect(serialized).not.toContain('token')
    expect(serialized).not.toContain('cookie')
  })
})
