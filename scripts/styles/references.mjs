// Check each theme/conditional definition set independently: opposite light/dark
// aliases can both be valid even though a union of their edges would form a cycle.
export function findVariableCycles(declarations) {
  const definitions = declarations.filter(item => item.property.startsWith('--'))
  const base = definitions.filter(item => item.selector === ':root' && !item.context)
  const variants = new Map()
  for (const item of definitions) {
    const key = `${item.selector}|${item.context || ''}`
    if (!variants.has(key)) variants.set(key, [])
    variants.get(key).push(item)
  }
  const errors = []
  for (const [key, variant] of variants) {
    const dark = key.startsWith('.dark|') ? definitions.filter(item => item.selector === '.dark' && !item.context) : []
    const graph = new Map([...base, ...dark, ...variant].map(item => [item.property, item]))
    const done = new Set(), active = new Set()
    function visit(token, path) {
      if (active.has(token)) { errors.push({ ...graph.get(token), message: `变量循环依赖：${[...path, token].join(' → ')}` }); return }
      if (done.has(token) || !graph.has(token)) return
      active.add(token)
      for (const reference of graph.get(token).references) visit(reference, [...path, token])
      active.delete(token)
      done.add(token)
    }
    for (const token of graph.keys()) visit(token, [])
  }
  return errors
}
