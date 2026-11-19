// Exercises the real publisher with a disposable Docker executable and registry.
// No real daemon, account credential, network request, repository tag or push.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { publish } from '../../scripts/release/publish.mjs'

const revision = 'b'.repeat(40), imageId = `sha256:${'a'.repeat(64)}`
const manifestDigest = `sha256:${'c'.repeat(64)}`
vi.mock('../../scripts/release/git.mjs', async importOriginal => ({
  ...await importOriginal<typeof import('../../scripts/release/git.mjs')>(),
  git: vi.fn((...args: string[]) => args[0] === 'branch' ? 'main' : ''),
  packageAt: vi.fn(() => ({ version: '2.0.9' })),
  taggedRevision: vi.fn(() => 'b'.repeat(40)),
}))
vi.mock('../../scripts/release/registry.mjs', async importOriginal => {
  const { readFileSync } = await import('node:fs')
  const current = () => JSON.parse(readFileSync(process.env.YUNPLEX_PUBLISH_FIXTURE!, 'utf8'))
  return {
    ...await importOriginal<typeof import('../../scripts/release/registry.mjs')>(),
    registry: () => ({
      manifest: async (tag: string) => current().remote[tag] || null,
      version: async (manifest: { imageId: string }) => current().versions[manifest.imageId],
    }),
  }
})

interface FixtureState {
  calls: string[][]
  remote: Record<string, { imageId: string; digest: string }>
  versions: Record<string, string>
  aliases: Record<string, string>
  runningImage: string
  failOnceTag?: string
  failedOnce?: boolean
}
let directory = '', statePath = ''
let originalPath: string | undefined, originalFixture: string | undefined
function state(): FixtureState { return JSON.parse(readFileSync(statePath, 'utf8')) }
function save(value: FixtureState) { writeFileSync(statePath, JSON.stringify(value)) }
const environment = () => ({
  RELEASE_TAG: 'v2.0.9', GHCR_IMAGE: 'ghcr.io/disposable/fixture', GHCR_USERNAME: 'fixture',
  GHCR_TOKEN: 'not-a-real-credential', NAS_APP_ROOT: '/volume1/docker/reyunplex', GHCR_UPDATE_LATEST: 'true',
})
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'yunplex-publication-'))
  statePath = join(directory, 'state.json')
  save({ calls: [], remote: {}, versions: { [imageId]: '2.0.9' }, aliases: {}, runningImage: imageId })
  originalPath = process.env.PATH
  originalFixture = process.env.YUNPLEX_PUBLISH_FIXTURE
  process.env.PATH = `${directory}:${originalPath}`
  process.env.YUNPLEX_PUBLISH_FIXTURE = statePath
  const docker = join(directory, 'docker')
  writeFileSync(docker, `#!${process.execPath}
const fs = require('node:fs')
const file = process.env.YUNPLEX_PUBLISH_FIXTURE
const state = JSON.parse(fs.readFileSync(file, 'utf8'))
const args = process.argv.slice(2)
state.calls.push(args)
const imageId = '${imageId}', revision = '${revision}', digest = '${manifestDigest}'
const candidate = { Id: imageId, Os: 'linux', Architecture: 'amd64', Config: { Labels: {
  'org.opencontainers.image.revision': revision, 'org.opencontainers.image.version': '2.0.9' } } }
let result = '', missing = false, failed = false
if (args[0] === 'info') result = { OSType: 'linux', Architecture: 'amd64' }
else if (args[0] === 'image' && args[1] === 'inspect') {
  if (args[2] === 'reyunplex:' + revision || state.aliases[args[2]]) result = candidate
  else missing = true
} else if (args[0] === 'container' && args[1] === 'inspect') {
  if (args[2] === 'reyunplex') result = { Image: state.runningImage, State: { Running: true }, Config: { Labels: { 'com.docker.compose.project': 'reyunplex' } } }
  else missing = true
} else if (args[0] === 'create') result = 'disposable-publication-lock'
else if (args[0] === 'run') result = { status: 'ready', revision, image: 'reyunplex:' + revision }
else if (args[0] === 'exec') result = { ready: true, version: '2.0.9' }
else if (args[0] === 'tag') state.aliases[args[2]] = args[1]
else if (args[0] === 'image' && args[1] === 'rm') delete state.aliases[args[2]]
else if (args[0] === 'push') {
  const tag = args[1].split(':').at(-1)
  if (state.failOnceTag === tag && !state.failedOnce) { state.failedOnce = true; failed = true }
  else state.remote[tag] = { imageId, digest }
}
fs.writeFileSync(file, JSON.stringify(state))
if (missing || failed) { process.stderr.write(missing ? 'No such image or container' : 'disposable transport failure'); process.exit(1) }
if (result) process.stdout.write(typeof result === 'string' ? result : JSON.stringify(args[0] === 'image' || args[0] === 'container' ? [result] : result))
`)
  chmodSync(docker, 0o700)
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  if (originalPath === undefined) delete process.env.PATH; else process.env.PATH = originalPath
  if (originalFixture === undefined) delete process.env.YUNPLEX_PUBLISH_FIXTURE; else process.env.YUNPLEX_PUBLISH_FIXTURE = originalFixture
  vi.restoreAllMocks()
  rmSync(directory, { recursive: true, force: true })
})

describe('publication safety and retry', () => {
  it('rejects a conflicting fixed tag before login or registry writes', async () => {
    const value = state()
    value.remote[`sha-${revision}`] = { imageId: `sha256:${'d'.repeat(64)}`, digest: manifestDigest }
    save(value)
    await expect(publish(environment())).rejects.toThrow('different content')
    expect(state().calls.some(args => ['login', 'push'].includes(args[0]!))).toBe(false)
  })

  it('refuses to downgrade latest before pushing any tag', async () => {
    const value = state(), newer = `sha256:${'d'.repeat(64)}`
    value.remote.latest = { imageId: newer, digest: manifestDigest }
    value.versions[newer] = '2.1.0'
    save(value)
    await expect(publish(environment())).rejects.toThrow('older version')
    expect(state().calls.some(args => args[0] === 'push')).toBe(false)
  })

  it('requires the accepted image to still be the running NAS image', async () => {
    const value = state(); value.runningImage = 'different-image'; save(value)
    await expect(publish(environment())).rejects.toThrow('running managed NAS deployment')
    expect(state().calls.some(args => args[0] === 'push')).toBe(false)
  })

  it('publishes fixed tags before latest and is idempotent on a repeated request', async () => {
    await publish(environment())
    const first = state().calls.filter(args => args[0] === 'push').map(args => args[1]?.split(':').at(-1))
    expect(first).toEqual([`sha-${revision}`, '2.0.9', 'latest'])
    await publish(environment())
    expect(state().calls.filter(args => args[0] === 'push')).toHaveLength(3)
    expect(new Set(Object.values(state().remote).map(value => value.imageId))).toEqual(new Set([imageId]))
    expect(state().aliases).toEqual({})
  })

  it('retries a partial publication without replacing the completed fixed tag', async () => {
    const value = state(); value.failOnceTag = '2.0.9'; save(value)
    await expect(publish(environment())).rejects.toThrow('Docker push failed')
    expect(state().remote.latest).toBeUndefined()
    await publish(environment())
    const pushes = state().calls.filter(args => args[0] === 'push').map(args => args[1]?.split(':').at(-1))
    expect(pushes).toEqual([`sha-${revision}`, '2.0.9', '2.0.9', 'latest'])
    expect(state().aliases).toEqual({})
  })
})
