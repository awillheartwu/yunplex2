import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'vue/compiler-sfc'
import { extractStyles } from '../../scripts/styles/extract.mjs'

const root = resolve(__dirname, '../..')
function ownStyles(file: string, visited = new Set<string>()): string {
  if (visited.has(file)) return ''
  visited.add(file)
  const source = readFileSync(resolve(root, file), 'utf8')
  const data = extractStyles(file, source)
  const css = file.endsWith('.vue') ? parse(source).descriptor.styles.map(style => style.content).join('\n') : source
  return css + data.imports.map((reference: string) => {
    const path = reference.replace(/^['"]|['"]$/g, '')
    const relative = path.startsWith('~/') ? path.slice(2) : resolve(dirname(file), path).slice(root.length + 1)
    return ownStyles(relative, visited)
  }).join('\n')
}

describe('media adoption component style ownership', () => {
  it.each([
    ['SourceInitializationReview', '.source-adoption__table'],
    ['SourceInitializationEvidence', '.source-adoption__drawer'],
    ['SourceInitializationSummary', '.source-adoption__commit'],
  ])('%s explicitly carries its internal styles when loaded alone', (component, selector) => {
    const file = `components/sources/${component}.vue`
    const styles = parse(readFileSync(resolve(root, file), 'utf8')).descriptor.styles
    expect(styles.length).toBeGreaterThan(0)
    expect(styles.every(style => style.scoped)).toBe(true)
    expect(ownStyles(file)).toContain(selector)
    expect(ownStyles(file)).not.toContain('.source-adoption__metrics')
  })

  it('keeps the parent page from styling review and portal internals', () => {
    const css = ownStyles('components/sources/SourceInitializationPanel.vue')
    expect(css).toContain('.source-adoption__metrics')
    expect(css).not.toContain('.source-adoption__drawer')
    expect(css).not.toContain('.source-adoption__table')
  })
})
