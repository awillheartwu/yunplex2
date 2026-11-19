import { readFileSync } from 'node:fs'
import { git, packageAt, requireCleanBranch, root, taggedRevision } from './git.mjs'

try {
  if (process.argv.length !== 2) throw new Error('Usage: pnpm release:tag')
  requireCleanBranch('main')
  const { version } = packageAt()
  const changelog = readFileSync(`${root}/CHANGELOG.md`, 'utf8')
  if (!changelog.split('\n').some(line => /^#{1,3} /.test(line) && line.replaceAll('[', '').split(/[\s\]()]/).includes(version))) {
    throw new Error('CHANGELOG.md must contain the prepared release version')
  }
  const tag = `v${version}`
  const head = git('rev-parse', 'HEAD')
  if (git('tag', '--list', tag)) {
    if (taggedRevision(tag) !== head) throw new Error(`${tag} already points to another commit; release tags must not be replaced`)
    console.log(`${tag} already identifies ${head}. Nothing changed.`)
  } else {
    git('tag', '-a', tag, '-m', `chore(release): ${tag}`)
    console.log(`${tag} identifies final main commit ${head}. Nothing was pushed.`)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Release tagging failed')
  process.exitCode = 1
}
