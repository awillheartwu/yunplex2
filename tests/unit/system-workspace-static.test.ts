import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../..', import.meta.url))

function readProjectFile(path: string) {
  return readFileSync(`${root}/${path}`, 'utf8')
}

describe('operations information architecture', () => {
  it('places monitoring on the dashboard, history in task center, and logs on their own route', () => {
    const dashboard = readProjectFile('pages/index.vue')
    const taskCenterPage = readProjectFile('components/task-center/TaskCenterPage.vue')
    const taskCenter = readProjectFile('composables/useTaskCenterPage.ts')
    const logsPage = readProjectFile('pages/logs.vue')

    expect(dashboard).toContain('<SystemMonitorPanel')
    expect(dashboard).toContain('useSystemMonitor()')
    expect(dashboard).not.toContain('>系统监控<')
    expect(taskCenter).toContain("{ key: 'runs', label: '运行记录' }")
    expect(taskCenterPage).toContain('<RunRecordsPanel v-else />')
    expect(logsPage).toContain('<SystemLogsPanel />')
    expect(logsPage).not.toContain('<PageTabs')
  })

  it('keeps monitor focused on health and current resources', () => {
    const monitor = readProjectFile('components/system/SystemMonitorPanel.vue')
    const composable = readProjectFile('composables/useSystemMonitor.ts')

    expect(monitor).toContain('<SystemHealthOverview')
    expect(monitor).toContain('<SystemKpiGrid')
    expect(monitor).not.toContain('SystemCharts')
    expect(monitor).not.toContain('SystemDataStats')
    expect(composable).toContain('}, 10000)')
    expect(readProjectFile('components/system/SystemHealthOverview.vue')).toContain('to="/logs"')
    expect(readProjectFile('components/system/SystemHealthOverview.vue')).toContain('repeat(4, minmax(0, 1fr))')
  })

  it('removes the superseded system workspace and retired list routes', () => {
    expect(existsSync(`${root}/pages/logs.vue`)).toBe(true)
    expect(existsSync(`${root}/pages/system.vue`)).toBe(false)
    expect(existsSync(`${root}/components/system/SystemPage.vue`)).toBe(false)
    expect(existsSync(`${root}/composables/useSystemPage.ts`)).toBe(false)
    expect(existsSync(`${root}/pages/jobs.vue`)).toBe(false)
    expect(existsSync(`${root}/pages/sources.vue`)).toBe(false)
    expect(readProjectFile('pages/task-center/index.vue')).not.toContain('navigateTo')
  })
})
