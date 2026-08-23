import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../..', import.meta.url))

function readProjectFile(path: string) {
  return readFileSync(`${root}/${path}`, 'utf8')
}

function expectTemplateBindingExposed(page: string, scriptSetup: string, returnBlock: string, binding: string) {
  expect(page).toContain(binding)
  expect(scriptSetup).toContain(binding)
  expect(returnBlock).toContain(binding)
}

describe('task center page bindings', () => {
  it('exposes failure filter bindings used by the page template', () => {
    const page = readProjectFile('components/task-center/TaskCenterPage.vue')
    const composable = readProjectFile('composables/useTaskCenterPage.ts')
    const scriptSetup = page.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)?.[1] || ''
    const returnBlock = composable.match(/return\s+\{([\s\S]*?)\n\s+\}/)?.[1] || ''

    expectTemplateBindingExposed(page, scriptSetup, returnBlock, 'failureTypeFilters')
    expectTemplateBindingExposed(page, scriptSetup, returnBlock, 'failureKindFilters')
    expectTemplateBindingExposed(page, scriptSetup, returnBlock, 'failureStatusTabs')
    expectTemplateBindingExposed(page, scriptSetup, returnBlock, 'overviewStageItems')
  })

  it('moves the run list into the system workspace', () => {
    const taskCenterPage = readProjectFile('components/task-center/TaskCenterPage.vue')
    const taskCenter = readProjectFile('composables/useTaskCenterPage.ts')
    const systemPage = readProjectFile('components/system/SystemPage.vue')
    const runHistory = readProjectFile('composables/useRunHistory.ts')

    expect(taskCenter).not.toContain("{ key: 'runs', label: '运行记录' }")
    expect(taskCenterPage).not.toContain("activeTab === 'runs'")
    expect(systemPage).toContain('<SystemRunRecordsPanel v-else />')
    expect(systemPage).not.toContain('<SystemMaintenancePanel')
    expect(runHistory).toContain('typeFilters')
    expect(runHistory).toContain('statusFilters')
  })

  it('shows the shared realtime download queue at the bottom of overview without a separate tab', () => {
    const page = readProjectFile('components/task-center/TaskCenterPage.vue')
    const panel = readProjectFile('components/task-center/DownloadQueuePanel.vue')
    const composable = readProjectFile('composables/useTaskCenterPage.ts')

    expect(composable).not.toContain("{ key: 'downloads', label: '下载队列' }")
    expect(composable).toContain("downloads: 'overview'")
    expect(composable).toContain('useDownloadQueue({ liveRunId: primaryActiveRunId, liveLimit: 12 })')
    expect(page).not.toContain("activeTab === 'downloads'")
    expect(page).not.toContain('compact-download-queue')
    expect(page).toContain('<DownloadQueuePanel')
    expect(page.indexOf('<DownloadQueuePanel')).toBeGreaterThan(page.indexOf('class="section-card issue-summary"'))
    expect(page).toContain('class="task-stage-rail"')
    expect(page).toContain('aria-current="stage.state')
    expect(page).toContain(':live-tasks="downloadQueue.liveTasks.value"')
    expect(page).toContain(':sync-state="syncState"')
    expect(page).toContain(':active-run="primaryActiveRun"')
    expect(panel).toContain('role="progressbar"')
    expect(panel).toContain('歌曲处理进度')
    expect(panel).toContain('downstreamLabel')
    expect(panel).not.toContain('重试失败')
    expect(panel).not.toContain('role="tablist"')
  })

  it('keeps manual download focused on creating work', () => {
    const page = readProjectFile('components/manual-download/ManualDownloadPage.vue')
    const composable = readProjectFile('composables/useManualDownloadPage.ts')
    const queue = readProjectFile('composables/useDownloadQueue.ts')

    expect(page).not.toContain('<PageTabs')
    expect(page).not.toContain('手动下载记录')
    expect(page).not.toContain('manual-queue-card')
    expect(page).toContain('to="/task-center"')
    expect(composable).not.toContain('useRuns(')
    expect(composable).not.toContain('useDownloadQueue(')
    expect(queue).not.toContain('/downloads/history')
  })
})
