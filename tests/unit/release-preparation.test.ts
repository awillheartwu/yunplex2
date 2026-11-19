import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const roots: string[] = []
const repository = resolve(import.meta.dirname, '../..')
const fixtureEnv = { ...process.env, HUSKY: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }

function git(root: string, ...args: string[]) {
  return execFileSync('git', args, { cwd: root, env: fixtureEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'reyunplex-release-'))
  roots.push(root)
  mkdirSync(join(root, 'scripts'), { recursive: true })
  cpSync(join(repository, 'scripts/release'), join(root, 'scripts/release'), { recursive: true })
  cpSync(join(repository, '.versionrc.json'), join(root, '.versionrc.json'))
  symlinkSync(join(repository, 'node_modules'), join(root, 'node_modules'))
  writeFileSync(join(root, '.gitignore'), 'node_modules/\n')
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'release-fixture', version: '2.0.9', private: true, type: 'module' }))
  git(root, 'init', '-b', 'dev')
  git(root, 'config', 'user.name', 'Release Fixture')
  git(root, 'config', 'user.email', 'fixture@example.invalid')
  git(root, 'add', '.')
  git(root, 'commit', '-m', 'feat: synchronize a source')
  return root
}

function run(root: string, script: 'prepare' | 'tag', ...args: string[]) {
  return spawnSync(process.execPath, [join(root, `scripts/release/${script}.mjs`), ...args], {
    cwd: root, env: fixtureEnv, encoding: 'utf8', timeout: 30_000,
  })
}

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('release preparation boundaries', () => {
  it('previews the first release without mutations and tags only the final main commit', () => {
    const root = fixture()
    const originalHead = git(root, 'rev-parse', 'HEAD')
    const preview = run(root, 'prepare', 'first', '--dry-run')
    expect(preview.status, preview.stderr).toBe(0)
    expect(git(root, 'rev-parse', 'HEAD')).toBe(originalHead)
    expect(git(root, 'status', '--porcelain')).toBe('')
    expect(git(root, 'tag', '--list')).toBe('')

    const prepared = run(root, 'prepare', 'first')
    expect(prepared.status, prepared.stderr).toBe(0)
    expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version).toBe('2.0.9')
    expect(readFileSync(join(root, 'CHANGELOG.md'), 'utf8')).toContain('2.0.9')
    expect(git(root, 'rev-parse', 'HEAD')).not.toBe(originalHead)
    expect(git(root, 'tag', '--list')).toBe('')
    expect(run(root, 'tag').status).toBe(1)

    git(root, 'switch', '-c', 'main')
    const finalHead = git(root, 'rev-parse', 'HEAD')
    expect(run(root, 'tag').status).toBe(0)
    expect(git(root, 'rev-parse', 'v2.0.9^{commit}')).toBe(finalHead)
    expect(git(root, 'cat-file', '-t', 'v2.0.9')).toBe('tag')
    expect(run(root, 'tag').status).toBe(0)

    writeFileSync(join(root, 'fixture-change'), 'later content')
    git(root, 'add', '.')
    git(root, 'commit', '-m', 'fix: later change')
    const conflict = run(root, 'tag')
    expect(conflict.status).toBe(1)
    expect(conflict.stderr).toContain('must not be replaced')
    expect(git(root, 'rev-parse', 'v2.0.9^{commit}')).toBe(finalHead)
    expect(git(root, 'remote')).toBe('')
  }, 30_000)

  it('rejects an ordinary initial patch and a dirty release workspace', () => {
    const root = fixture()
    const patch = run(root, 'prepare', 'patch')
    expect(patch.status).toBe(1)
    expect(patch.stderr).toContain('release:first')
    writeFileSync(join(root, 'uncommitted'), 'keep this work')
    const dirty = run(root, 'prepare', 'first')
    expect(dirty.status).toBe(1)
    expect(readFileSync(join(root, 'uncommitted'), 'utf8')).toBe('keep this work')
    expect(git(root, 'tag', '--list')).toBe('')
  })
})
