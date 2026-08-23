import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../..', import.meta.url))

function readProjectFile(path: string) {
  return readFileSync(`${root}/${path}`, 'utf8')
}

describe('system workspace information architecture', () => {
  it('hosts monitor, logs, and runs as system tabs', () => {
    const page = readProjectFile('components/system/SystemPage.vue')
    const composable = readProjectFile('composables/useSystemPage.ts')

    expect(composable).toContain("{ key: 'monitor', label: '系统监控' }")
    expect(composable).toContain("{ key: 'logs', label: '系统日志' }")
    expect(composable).toContain("{ key: 'runs', label: '运行记录' }")
    expect(page).toContain("activeTab === 'monitor'")
    expect(page).toContain("activeTab === 'logs'")
    expect(page).toContain('<SystemRunRecordsPanel v-else />')
  })

  it('redirects retired list routes into their system tabs', () => {
    expect(readProjectFile('pages/logs.vue')).toContain("navigateTo('/system?tab=logs'")
    expect(readProjectFile('pages/jobs.vue')).toContain("navigateTo('/system?tab=runs'")
    expect(readProjectFile('pages/task-center/index.vue')).toContain("legacyRunTabs.has(requestedTab)")
  })
})
