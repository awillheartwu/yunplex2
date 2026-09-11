import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

describe('settings information architecture', () => {
  it('uses task-oriented groups and keeps danger actions out of the header', () => {
    const page = read('pages/config.vue')

    expect(page).toContain("{ key: 'general', label: '服务连接' }")
    expect(page).toContain("{ key: 'media', label: '下载与文件' }")
    expect(page).toContain("{ key: 'advanced', label: '安全与维护' }")
    expect(page).toContain("{ key: 'sync', label: '同步策略' }")
    expect(page).toContain("{ key: 'display', label: '外观' }")
    expect(page).not.toContain("key: 'preferences'")
    expect(page).toContain('title="危险操作"')
    expect(page.indexOf('恢复默认')).toBeGreaterThan(page.indexOf('title="危险操作"'))
  })

  it('keeps all current product controls in a clear group', () => {
    const page = read('pages/config.vue')

    expect(page).toContain("activeTab === 'general'")
    expect(page).toContain("activeTab === 'media'")
    expect(page).toContain("activeTab === 'advanced'")
    expect(page).toContain('title="同步策略"')
    expect(page).toContain('title="艺人写入规则"')
    expect(page).toContain('title="数据保留"')
    expect(page).toContain('title="安全"')
  })

  it('shares one connection-test service between settings and setup', () => {
    const configApi = read('server/api/config/test-connection.post.ts')
    const setupChecks = read('server/lib/setup/checks.ts')

    expect(configApi).toContain('runConnectionTest')
    expect(setupChecks).toContain('runConnectionTest')
    expect(setupChecks).not.toContain('checkCookie')
    expect(setupChecks).not.toContain('initPlexClient')
  })
})
