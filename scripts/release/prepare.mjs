import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { git, packageAt, requireCleanBranch, root } from './git.mjs'

try {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const modes = args.filter(value => value !== '--dry-run')
  const mode = modes[0] ?? 'auto'
  if (modes.length > 1 || !['auto', 'first', 'patch', 'minor', 'major'].includes(mode)) {
    throw new Error('Usage: pnpm release [first|patch|minor|major] [--dry-run]')
  }
  requireCleanBranch('dev')
  const stableTags = git('tag', '--list').split('\n').filter(value => /^v\d+\.\d+\.\d+$/.test(value))
  packageAt()
  if (!stableTags.length && mode !== 'first') throw new Error('Use pnpm release:first for the initial release at the current package version')
  if (mode === 'first' && stableTags.length) {
    throw new Error('First release requires no existing stable release tags')
  }
  const options = ['--skip.tag']
  if (mode === 'first') options.push('--first-release')
  else if (mode !== 'auto') options.push('--release-as', mode)
  if (dryRun) options.push('--dry-run')
  const cli = fileURLToPath(import.meta.resolve('commit-and-tag-version/bin/cli.js'))
  execFileSync(process.execPath, [cli, ...options], { cwd: root, stdio: 'inherit' })
  console.log(dryRun ? 'Preview complete; no files, commits or tags changed.' : 'Release commit prepared on dev. Review it, then merge into main before running pnpm release:tag. Nothing was pushed.')
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Release preparation failed')
  process.exitCode = 1
}
