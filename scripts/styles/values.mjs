import valueParser from 'postcss-value-parser'
import colorNames from 'color-name'
import { managedProperties } from './extract.mjs'

const names = new Set(Object.keys(colorNames))
const colorFunctions = new Set(['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color', 'device-cmyk'])
const globalKeywords = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer'])
const normalized = value => value.replace(/\s+/g, '')

function exception(declaration) {
  const { file, selector, property, value, expression } = declaration
  if (file === 'assets/css/fonts.css' && declaration.context?.startsWith('@font-face') && ['font-family', 'font-weight'].includes(property)) return true
  if (file === 'assets/css/main.css' && selector === 'html' && property === 'font-size' && normalized(value || '') === 'calc(16px*var(--font-scale,1))') return true
  return file === 'pages/config.vue' && property === 'font-size' && normalized(expression || '') === '`${Math.round((form.other.fontScale||1)*16)}px`'
}

export function inspectValue(declaration, definitions) {
  const { file, property, value } = declaration
  const errors = [], references = []
  const theme = file === 'assets/css/tokens.css'
  if (value === null) {
    if (managedProperties.has(property) && !exception(declaration)) errors.push(`动态 ${property} 需要明确的设计变量或有理由的例外`)
    return { errors, references }
  }
  const ast = valueParser(value)
  const scale = managedProperties.has(property) && !theme && !exception(declaration)
  function walk(nodes) {
    for (const node of nodes) {
      if (node.type === 'comment' || node.type === 'space' || node.type === 'div') continue
      if (node.type === 'function') {
        const name = node.value.toLowerCase()
        if (node.unclosed) errors.push(`未闭合的 CSS 函数：${node.value}`)
        if (!theme && colorFunctions.has(name)) errors.push(`颜色函数必须移入主题变量：${node.value}()`)
        if (name === 'var') {
          const first = node.nodes.find(child => child.type !== 'space' && child.type !== 'comment')
          if (!first || first.type !== 'word' || !first.value.startsWith('--')) errors.push('var() 必须引用有效的自定义属性')
          else {
            references.push(first.value)
            if (!definitions.has(first.value)) errors.push(`未定义的样式变量：${first.value}`)
          }
          const comma = node.nodes.findIndex(child => child.type === 'div' && child.value === ',')
          if (comma >= 0) walk(node.nodes.slice(comma + 1))
        } else if (name !== 'url') walk(node.nodes)
        continue
      }
      if (node.type === 'string') {
        if (scale) errors.push(`${property} 必须使用设计变量：${node.value}`)
        continue
      }
      const lower = node.value.toLowerCase()
      if (!theme && (names.has(lower) || /^#[\da-f]{3,8}$/i.test(node.value))) errors.push(`颜色必须使用语义变量：${node.value}`)
      if (scale && !globalKeywords.has(lower) && !['+', '-', '*', '/'].includes(lower)) {
        if (property === 'border-radius' && ['0', '50%'].includes(lower)) continue
        errors.push(`${property} 必须使用设计变量：${node.value}`)
      }
    }
  }
  walk(ast.nodes)
  return { errors: [...new Set(errors)], references: [...new Set(references)] }
}

const palettes = '(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)'
const utilities = new RegExp(`^(?:bg|text|border(?:-[trblxy])?|ring(?:-offset)?|from|via|to|fill|stroke|decoration|divide|placeholder)-${palettes}(?:-\\d+)?(?:/[^ ]+)?$`)
export function inspectClasses(value, definitions) {
  const errors = []
  for (const item of value.split(/\s+/)) {
    const utility = item.replace(/^(?:[\w-]+:)+/, '').replace(/^!/, '')
    if (utilities.test(utility)) errors.push(`工具类必须使用语义颜色：${item}`)
    const arbitrary = utility.match(/^(text|font|rounded(?:-[\w]+)?|bg|border|shadow|ring|fill|stroke)-\[(.*)\](?:\/.*)?$/)
    if (!arbitrary) continue
    const [, kind, raw] = arbitrary
    const property = kind === 'font' ? (/^\d/.test(raw) ? 'font-weight' : 'font-family') : kind.startsWith('rounded') ? 'border-radius' : kind === 'text' && (/^(?:length:)?(?:\d|calc\(|clamp\(|min\(|max\()/.test(raw) || raw.includes('--text-')) ? 'font-size' : 'color'
    errors.push(...inspectValue({ file: '<utility>', property, value: raw.replace(/_/g, ' ').replace(/^(length|color):/, '') }, definitions).errors)
  }
  return [...new Set(errors)]
}
