import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { analyzeStyles } from './styles/analyze.mjs'

const root = resolve(import.meta.dirname, '..')
const files = ['assets/css', 'components', 'layouts', 'pages', 'composables', 'lib'].flatMap(directory =>
  readdirSync(resolve(root, directory), { recursive: true })
    .filter(file => /\.(css|vue|ts)$/.test(file) && !file.endsWith('.test.ts'))
    .map(file => `${directory}/${file}`),
)
const sources = files.map(file => ({ file, source: readFileSync(resolve(root, file), 'utf8') }))
const failures = analyzeStyles(sources)
if (failures.length) {
  console.error(failures.map(({ file, line, message }) => `${file}:${line}: ${message}`).join('\n'))
  process.exitCode = 1
} else {
  console.log(`Design tokens: ${sources.length} UI/style modules parsed; colors, type scales, imports and variable references passed.`)
}
