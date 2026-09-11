import { posix } from 'node:path'
import valueParser from 'postcss-value-parser'
import { extractStyles } from './extract.mjs'
import { inspectClasses, inspectValue } from './values.mjs'
import { findVariableCycles } from './references.mjs'
import { inspectStructure } from './structure.mjs'

export function analyzeStyles(sources) {
  const extracted = new Map(sources.map(({ file, source }) => [file, extractStyles(file, source)]))
  const diagnostics = [], globals = new Set(), local = new Map(), dependencies = new Map()
  for (const [file, data] of extracted) {
    diagnostics.push(...data.errors, ...inspectStructure(file, data.roots))
    const definitions = new Set()
    for (const declaration of data.declarations) {
      if (!declaration.property.startsWith('--')) continue
      definitions.add(declaration.property)
      if (declaration.scope === 'global') globals.add(declaration.property)
    }
    local.set(file, definitions)
    const imports = []
    for (const text of data.imports) {
      const ast = valueParser(text)
      const node = ast.nodes.find(node => node.type !== 'space' && node.type !== 'comment')
      const target = node?.type === 'function' && node.value === 'url' ? node.nodes[0]?.value : node?.value
      if (!target || /^(https?:|data:)/.test(target)) continue
      const path = target.startsWith('~/') || target.startsWith('@/') ? target.slice(2) : target.startsWith('~~/') ? target.slice(3) : posix.normalize(posix.join(posix.dirname(file), target))
      if (!extracted.has(path)) diagnostics.push({ file, line: 1, message: `样式依赖不存在：${target}` })
      else imports.push(path)
    }
    dependencies.set(file, imports)
  }
  // CSS imports share the importing component's scope, but sibling components do not.
  function definitionsFor(file, visited = new Set()) {
    if (visited.has(file)) return new Set()
    visited.add(file)
    const result = new Set(local.get(file))
    for (const child of dependencies.get(file) || []) for (const token of definitionsFor(child, visited)) result.add(token)
    return result
  }
  for (const [file, data] of extracted) {
    const definitions = new Set([...globals, ...definitionsFor(file)])
    // Imported page sheets can also reference variables supplied by their owner.
    for (const [owner, imports] of dependencies) if (imports.includes(file)) for (const token of definitionsFor(owner)) definitions.add(token)
    const checkedDeclarations = []
    for (const declaration of data.declarations) {
      const result = inspectValue(declaration, definitions)
      for (const message of result.errors) diagnostics.push({ file, line: declaration.line, message })
      checkedDeclarations.push({ ...declaration, references: result.references })
    }
    for (const item of data.classes) for (const message of inspectClasses(item.value, definitions)) diagnostics.push({ file, line: item.line, message })
    diagnostics.push(...findVariableCycles(checkedDeclarations).map(({ file, line, message }) => ({ file, line, message })))
  }
  return diagnostics.filter((item, index, all) => all.findIndex(other => other.file === item.file && other.line === item.line && other.message === item.message) === index)
}
