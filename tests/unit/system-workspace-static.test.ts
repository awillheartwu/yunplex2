import { existsSync, readFileSync } from 'node:fs'
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

  it('keeps monitor focused on health and current resources', () => {
    const monitor = readProjectFile('components/system/SystemMonitorPanel.vue')
    const composable = readProjectFile('composables/useSystemPage.ts')

    expect(monitor).toContain('<SystemHealthOverview')
    expect(monitor).toContain('<SystemKpiGrid')
    expect(monitor).not.toContain('SystemCharts')
    expect(monitor).not.toContain('SystemDataStats')
    expect(composable).toContain('}, 10000)')
  })

  it('removes retired list routes while keeping the active run detail compatibility', () => {
    expect(existsSync(`${root}/pages/logs.vue`)).toBe(false)
    expect(existsSync(`${root}/pages/jobs.vue`)).toBe(false)
    expect(existsSync(`${root}/pages/sources.vue`)).toBe(false)
    expect(readProjectFile('pages/task-center/index.vue')).toContain("legacyRunTabs.has(requestedTab)")
  })
})
