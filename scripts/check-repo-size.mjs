import { execFileSync } from 'node:child_process'
import { existsSync, statSync, readFileSync } from 'node:fs'
import { extname } from 'node:path'

const MAX_TRACKED_FILE_BYTES = 1024 * 1024
const MAX_UNTRACKED_FILE_BYTES = 1024 * 1024
const MAX_SOURCE_LINES = 800
const SOURCE_EXTENSIONS = new Set([
  '.css',
  '.cjs',
  '.js',
  '.jsx',
  '.mjs',
  '.scss',
  '.sql',
  '.ts',
  '.tsx',
  '.vue',
])

const EXEMPT_TRACKED_FILES = new Set([
  'pnpm-lock.yaml',
])

function gitLines(args) {
  const output = execFileSync('git', args, { encoding: 'utf8' })
  return output.split('\0').filter(Boolean)
}

function byteLabel(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function lineCount(file) {
  return readFileSync(file, 'utf8').split('\n').length
}

function isSource(file) {
  return SOURCE_EXTENSIONS.has(extname(file))
}

const problems = []
const trackedFiles = gitLines(['ls-files', '-z'])
const untrackedFiles = gitLines(['ls-files', '-o', '--exclude-standard', '-z'])
const ignoredTrackedFiles = gitLines(['ls-files', '-i', '-c', '--exclude-standard', '-z'])
const sourceFiles = [...new Set([...trackedFiles, ...untrackedFiles])].sort()

for (const file of ignoredTrackedFiles) {
  problems.push(`tracked file is ignored by .gitignore: ${file}`)
}

for (const file of trackedFiles) {
  if (!existsSync(file) || EXEMPT_TRACKED_FILES.has(file)) continue
  const size = statSync(file).size
  if (size > MAX_TRACKED_FILE_BYTES) {
    problems.push(`tracked file is too large: ${file} (${byteLabel(size)})`)
  }
}

for (const file of untrackedFiles) {
  if (!existsSync(file)) continue
  const size = statSync(file).size
  if (size > MAX_UNTRACKED_FILE_BYTES) {
    problems.push(`untracked, unignored file is too large: ${file} (${byteLabel(size)})`)
  }
}

for (const file of sourceFiles) {
  if (!isSource(file) || !existsSync(file)) continue
  const lines = lineCount(file)
  if (lines > MAX_SOURCE_LINES) {
    problems.push(`source file exceeds ${MAX_SOURCE_LINES} lines: ${file} (${lines})`)
  }
}

if (problems.length > 0) {
  console.error('Repository size check failed:')
  for (const problem of problems) {
    console.error(`- ${problem}`)
  }
  process.exit(1)
}

console.log('Repository size check passed.')
