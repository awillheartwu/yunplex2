import postcss from 'postcss'
import { parse as parseVue } from 'vue/compiler-sfc'
import ts from 'typescript'

export const managedProperties = new Set(['font-size', 'font-weight', 'font-family', 'border-radius'])
const styleProperties = new Set([...managedProperties, 'color', 'background', 'background-color', 'background-image', 'border', 'border-color', 'border-top', 'border-right', 'border-bottom', 'border-left', 'outline', 'outline-color', 'box-shadow', 'text-shadow', 'fill', 'stroke', 'accent-color', 'scrollbar-color'])
const kebab = value => value.startsWith('--') ? value : value.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)

export function extractStyles(file, source) {
  const declarations = [], classes = [], errors = [], imports = [], roots = []
  function css(content, line = 1, scope = 'local') {
    try {
      const root = postcss.parse(content, { from: file })
      roots.push(root)
      root.walkDecls(node => {
        const context = []
        for (let parent = node.parent; parent; parent = parent.parent) if (parent.type === 'atrule') context.unshift(`@${parent.name} ${parent.params}`)
        declarations.push({ file, property: node.prop, value: node.value, line: line + node.source.start.line - 1, selector: node.parent.selector || '', scope, context: context.join(' / ') })
      })
      root.walkAtRules('import', node => imports.push(node.params))
    } catch (error) { errors.push({ file, line: line + (error.line || 1) - 1, message: `CSS 解析失败：${error.reason || error.message}` }) }
  }
  function javascript(content, line = 1, style = false) {
    const tree = ts.createSourceFile(file + '.ts', style ? `(${content})` : content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    function values(node) {
      if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) return values(node.expression)
      if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return [{ value: node.text }]
      if (ts.isConditionalExpression(node)) return [...values(node.whenTrue), ...values(node.whenFalse)]
      return [{ value: null, expression: node.getText(tree) }]
    }
    function add(property, node) {
      property = kebab(property)
      if (!styleProperties.has(property) && !property.startsWith('--')) return
      for (const value of values(node)) declarations.push({ file, property, ...value, line: line + tree.getLineAndCharacterOfPosition(node.getStart(tree)).line, selector: '<script>', scope: 'local' })
    }
    function visit(node) {
      if (ts.isPropertyAssignment(node)) add(node.name.getText(tree).replace(/^['"]|['"]$/g, ''), node.initializer)
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left)) add(node.left.name.text, node.right)
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isElementAccessExpression(node.left) && ts.isStringLiteralLike(node.left.argumentExpression)) add(node.left.argumentExpression.text, node.right)
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'setProperty' && node.arguments.length >= 2 && ts.isStringLiteralLike(node.arguments[0])) add(node.arguments[0].text, node.arguments[1])
      if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
        const at = line + tree.getLineAndCharacterOfPosition(node.getStart(tree)).line
        classes.push({ value: node.text, line: at })
        if (style && /^[\w-]+\s*:/.test(node.text)) css(node.text, at)
      }
      ts.forEachChild(node, visit)
    }
    visit(tree)
  }
  if (file.endsWith('.css')) css(source, 1, file === 'assets/css/tokens.css' || file === 'assets/css/main.css' || file.startsWith('assets/css/global/') ? 'global' : 'local')
  else if (file.endsWith('.vue')) {
    const parsed = parseVue(source, { filename: file })
    for (const error of parsed.errors) errors.push({ file, line: error.loc?.start.line || 1, message: `Vue 解析失败：${error.message || error}` })
    for (const block of parsed.descriptor.styles) {
      if (block.src) imports.push(JSON.stringify(block.src))
      css(block.content, block.loc.start.line)
    }
    for (const block of [parsed.descriptor.script, parsed.descriptor.scriptSetup]) if (block) javascript(block.content, block.loc.start.line)
    function template(node) {
      for (const attribute of node.props || []) {
        if (attribute.type === 6 && attribute.value) {
          if (attribute.name === 'style') css(attribute.value.content, attribute.loc.start.line)
          if (attribute.name === 'class') classes.push({ value: attribute.value.content, line: attribute.loc.start.line })
        }
        if (attribute.type === 7 && attribute.name === 'bind' && attribute.exp) {
          const name = attribute.arg?.content
          if (name === 'style' || name === 'class') javascript(attribute.exp.content, attribute.exp.loc.start.line, name === 'style')
        }
      }
      for (const child of node.children || []) template(child)
    }
    if (parsed.descriptor.template?.ast) template(parsed.descriptor.template.ast)
  } else javascript(source)
  return { file, declarations, classes, errors, imports, roots }
}
