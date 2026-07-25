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
  it('exposes filter option bindings used by the page template', () => {
    const page = readProjectFile('components/task-center/TaskCenterPage.vue')
    const composable = readProjectFile('composables/useTaskCenterPage.ts')
    const scriptSetup = page.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)?.[1] || ''
    const returnBlock = composable.match(/return\s+\{([\s\S]*?)\n\s+\}/)?.[1] || ''

    expectTemplateBindingExposed(page, scriptSetup, returnBlock, 'runTypeFilters')
    expectTemplateBindingExposed(page, scriptSetup, returnBlock, 'runStatusFilters')
    expectTemplateBindingExposed(page, scriptSetup, returnBlock, 'failureTypeFilters')
    expectTemplateBindingExposed(page, scriptSetup, returnBlock, 'failureKindFilters')
    expectTemplateBindingExposed(page, scriptSetup, returnBlock, 'failureStatusTabs')
    expectTemplateBindingExposed(page, scriptSetup, returnBlock, 'overviewStageItems')
  })

  it('shows the shared realtime download queue at the bottom of overview without a separate tab', () => {
    const page = readProjectFile('components/task-center/TaskCenterPage.vue')
    const panel = readProjectFile('components/task-center/DownloadQueuePanel.vue')
    const composable = readProjectFile('composables/useTaskCenterPage.ts')

    expect(composable).not.toContain("{ key: 'downloads', label: '下载队列' }")
    expect(composable).toContain("downloads: 'overview'")
    expect(composable).toContain('useDownloadQueue({ includeHistory: false, liveRunId: primaryActiveRunId, liveLimit: 12 })')
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
})
