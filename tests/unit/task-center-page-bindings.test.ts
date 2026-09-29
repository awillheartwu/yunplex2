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
  })

  it('keeps the run list inside the task center', () => {
    const taskCenterPage = readProjectFile('components/task-center/TaskCenterPage.vue')
    const taskCenter = readProjectFile('composables/useTaskCenterPage.ts')
    const runHistory = readProjectFile('composables/useRunHistory.ts')

    expect(taskCenter).toContain("{ key: 'runs', label: '运行记录' }")
    expect(taskCenter).toContain("tab === 'runs'")
    expect(taskCenter.indexOf("{ key: 'runs', label: '运行记录' }")).toBeLessThan(taskCenter.indexOf("{ key: 'failures', label: '异常处理' }"))
    expect(taskCenterPage).toContain('<RunRecordsPanel v-else />')
    expect(readProjectFile('components/task-center/ActivityOverview.vue')).toContain('to="/sync-sources"')
    expect(readProjectFile('components/task-center/ActivityOverview.vue')).toContain('to="/manual-download"')
    expect(runHistory).toContain('typeFilters')
    expect(runHistory).toContain('statusFilters')
  })

  it('keeps manual download focused on creating work', () => {
    const page = readProjectFile('components/manual-download/ManualDownloadPage.vue')
    const composable = readProjectFile('composables/useManualDownloadPage.ts')

    expect(page).not.toContain('<PageTabs')
    expect(page).not.toContain('手动下载记录')
    expect(page).not.toContain('manual-queue-card')
    expect(page).toContain('to="/task-center"')
    expect(composable).not.toContain('useRuns(')
    expect(composable).not.toContain('useDownloadQueue(')
  })
})
