import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const root = fileURLToPath(new URL('../../', import.meta.url))
export const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

export function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

export function packageAt(ref) {
  const content = ref ? git('show', `${ref}:package.json`) : readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
  const value = JSON.parse(content)
  if (!stableVersion.test(value.version)) throw new Error('Release requires a stable major.minor.patch version')
  return value
}

export function requireCleanBranch(branch) {
  if (git('branch', '--show-current') !== branch) throw new Error(`Run this command on ${branch}`)
  if (git('status', '--porcelain')) throw new Error('Commit or preserve all working-tree changes before preparing a release')
}

export function taggedRevision(tag) {
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag)) throw new Error('Expected a stable release tag such as v2.0.1')
  return git('rev-parse', '--verify', `refs/tags/${tag}^{commit}`)
}
