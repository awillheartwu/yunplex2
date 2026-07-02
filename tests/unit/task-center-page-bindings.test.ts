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
  })
})
