import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../..', import.meta.url))

function readProjectFile(path: string) {
  return readFileSync(`${root}/${path}`, 'utf8')
}

describe('task center page bindings', () => {
  it('exposes every failure tab binding used by the page template', () => {
    const page = readProjectFile('components/task-center/TaskCenterPage.vue')
    const composable = readProjectFile('composables/useTaskCenterPage.ts')
    const scriptSetup = page.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)?.[1] || ''
    const returnBlock = composable.match(/return\s+\{([\s\S]*?)\n\s+\}/)?.[1] || ''

    expect(page).toContain('v-for="item in failureStatusTabs"')
    expect(scriptSetup).toContain('failureStatusTabs')
    expect(returnBlock).toContain('failureStatusTabs')
  })
})
