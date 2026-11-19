const structured = /^(?:assets\/css\/pages\/(?:config|task-center(?:-(?:overview|failures))?|manual-download-(?:workspace|input|results))\.css|assets\/css\/components\/source-initialization-[\w-]+\.css)$/

export function inspectStructure(file, roots) {
  if (!structured.test(file)) return []
  const diagnostics = [], seen = new Map()
  for (const root of roots) {
    for (const [index, line] of root.source.input.css.split('\n').entries()) {
      if (line.length > 240) diagnostics.push({ file, line: index + 1, message: '样式行超过 240 字符，请展开规则以便维护' })
    }
    root.walkRules(rule => {
      const context = []
      for (let parent = rule.parent; parent; parent = parent.parent) if (parent.type === 'atrule') context.unshift(`@${parent.name} ${parent.params.replace(/\s*:\s*/g, ':')}`)
      for (const selector of list.comma(rule.selector)) {
        const key = `${context.join('/')}|${selector.replace(/\s+/g, ' ').trim()}`
        if (seen.has(key)) diagnostics.push({ file, line: rule.source.start.line, message: `相同条件下重复选择器 ${selector}，首次定义在第 ${seen.get(key)} 行` })
        else seen.set(key, rule.source.start.line)
      }
    })
  }
  return diagnostics
}
import { list } from 'postcss'
