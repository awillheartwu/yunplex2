import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deploymentConfig } from '../../scripts/deploy/nas-deploy.mjs'
import { startDeployment } from '../../scripts/deploy/start-deployment.mjs'
import { hostOperation } from '../../scripts/deploy/host-state.mjs'
import { pruneImages } from '../../scripts/deploy/retention.mjs'

const roots: string[] = []
const revision = 'a'.repeat(40)
const config = () => deploymentConfig({
  REYUNPLEX_IMAGE: `reyunplex:${revision}`, REYUNPLEX_REVISION: revision,
  NAS_APP_ROOT: '/volume1/docker/reyunplex', NAS_MUSIC_DIR: '/volume1/music', NAS_UID: '1000', NAS_GID: '1000',
})
afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

function workerHarness(options: { cancelWait?: boolean; copyFails?: boolean; previousRunning?: boolean; failedWorker?: boolean } = {}) {
  const calls: string[][] = []
  let inspected = 0
  const docker = async (args: string[]) => {
    calls.push(args)
    if (args[0] === 'container') {
      if (!options.previousRunning) return null
      return JSON.stringify({ Id: 'previous-worker', Config: { Labels: { 'reyunplex.role': 'deploy-worker' } }, State: { Running: inspected++ === 0 } })
    }
    if (args[0] === 'create') return 'new-worker'
    if (args[0] === 'cp' && args[2] === 'new-worker:/workspace') {
      expect(await readFile(join(args[1]!, 'ancestors.txt'), 'utf8')).toContain(revision)
      expect(await readFile(join(args[1]!, 'deploy', 'nas.compose.yml'), 'utf8')).toContain('NAS_MEMORY')
      expect(await readFile(join(args[1]!, 'scripts', 'deploy', 'retention.mjs'), 'utf8')).toContain('pruneImages')
      if (options.copyFails) throw new Error('copy failed')
    }
    if (args[0] === 'wait') {
      if (options.cancelWait) throw new Error('Actions waiter canceled')
      return options.failedWorker ? '1' : '0'
    }
    return ''
  }
  const dependencies = { docker, ancestors: async () => `${revision}\n${'b'.repeat(40)}\n`, sleep: async () => {} }
  return { calls, dependencies }
}

it('copies only deployment tools and SHA ancestry, then waits for a separate worker', async () => {
  const h = workerHarness()
  await startDeployment(config(), h.dependencies)
  const create = h.calls.find(args => args[0] === 'create')!
  expect(create).toContain('type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock')
  expect(create).toContain('--network'); expect(create).toContain('none')
  expect(create).toContain('256m')
  const forwarded = create.filter((_, index) => create[index - 1] === '--env').map(value => value.split('=')[0])
  expect(forwarded.sort()).toEqual([
    'DOCKER_API_VERSION', 'NAS_APP_ROOT', 'NAS_BIND_ADDRESS', 'NAS_CPUS', 'NAS_GID', 'NAS_MEMORY',
    'NAS_MUSIC_DIR', 'NAS_PORT', 'NAS_UID', 'REYUNPLEX_ANCESTORS_FILE', 'REYUNPLEX_IMAGE', 'REYUNPLEX_REVISION',
  ].sort())
  expect(h.calls.findIndex(args => args[0] === 'start')).toBeGreaterThan(h.calls.findLastIndex(args => args[0] === 'cp'))
  expect(h.calls.at(-1)).toEqual(['rm', 'new-worker'])
})

it('leaves the running deployment intact when the Actions waiter is canceled', async () => {
  const h = workerHarness({ cancelWait: true })
  await expect(startDeployment(config(), h.dependencies)).rejects.toThrow('canceled')
  expect(h.calls).toContainEqual(['start', 'new-worker'])
  expect(h.calls.some(args => ['rm', 'stop', 'kill'].includes(args[0]!))).toBe(false)
})

it('cleans a worker that was never started when copying fails', async () => {
  const h = workerHarness({ copyFails: true })
  await expect(startDeployment(config(), h.dependencies)).rejects.toThrow('copy failed')
  expect(h.calls).toContainEqual(['rm', 'new-worker'])
  expect(h.calls.some(args => args[0] === 'start')).toBe(false)
  expect(h.calls.flat()).not.toContain('-f')
})

it('waits for a previous deployment and removes only its completed container', async () => {
  const h = workerHarness({ previousRunning: true })
  await startDeployment(config(), h.dependencies)
  expect(h.calls.filter(args => args[0] === 'container')).toHaveLength(2)
  expect(h.calls).toContainEqual(['rm', 'previous-worker'])
  expect(h.calls.findIndex(args => args[0] === 'create')).toBeGreaterThan(h.calls.findIndex(args => args[0] === 'rm'))
})

it('preserves a failed worker for diagnosis and fails the Actions step', async () => {
  const h = workerHarness({ failedWorker: true })
  await expect(startDeployment(config(), h.dependencies)).rejects.toThrow('worker failed')
  expect(h.calls).toContainEqual(['logs', '--tail', '80', 'new-worker'])
  expect(h.calls.some(args => args[0] === 'rm')).toBe(false)
})

it('retains the newest three images, prior image and all container images without touching foreign tags', async () => {
  const images = Array.from({ length: 7 }, (_, i) => ({
    Id: `sha256:${i}`, Created: `2026-10-0${7 - i}T00:00:00Z`,
    RepoTags: [`reyunplex:${String(i).repeat(40)}`],
  }))
  images[5]!.RepoTags.push('another-project:latest')
  const calls: string[][] = []
  const run = async (args: string[]) => {
    calls.push(args)
    if (args[0] === 'image' && args[1] === 'ls') return images.map(image => image.Id).join('\n')
    if (args[0] === 'image' && args[1] === 'inspect') return JSON.stringify(images)
    if (args[0] === 'ps') return 'app-container\nother-container'
    if (args[0] === 'container') return 'sha256:6\nsha256:4'
    return ''
  }
  await pruneImages(run, ['sha256:3'])
  expect(calls.filter(args => args[1] === 'rm')).toEqual([['image', 'rm', `reyunplex:${'5'.repeat(40)}`]])
  expect(calls.filter(args => args[1] === 'prune')).toEqual([
    ['image', 'prune', '--force', '--filter', 'label=reyunplex.build-cache=true', '--filter', 'until=168h'],
  ])
  expect(calls.flat()).not.toContain('another-project:latest')
})

it('keeps three completed backups and a protected older backup, ignoring partial and unmanaged directories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reyunplex-retention-')); roots.push(root)
  const owner = { uid: process.getuid!(), gid: process.getgid!() }
  await hostOperation({ action: 'prepare', ...owner }, root)
  const backups = join(root, 'backups')
  const names = Array.from({ length: 5 }, (_, i) => `reyunplex-2026-10-0${i + 1}T00-00-00-000Z`)
  for (const name of names) {
    await mkdir(join(backups, name))
    await writeFile(join(backups, name, 'manifest.json'), JSON.stringify({ format: 1, appVersion: 'test-image', files: [] }))
  }
  await mkdir(join(backups, `${names[0]}.partial`))
  await mkdir(join(backups, 'manual-backup'))
  await symlink(join(backups, names[1]!), join(backups, 'reyunplex-2026-09-01T00-00-00-000Z'))
  await hostOperation({ action: 'retain', keep: 3, backup: `backups/${names[0]}` }, root)
  expect((await readdir(backups)).sort()).toEqual([
    names[0], names[2], names[3], names[4], `${names[0]}.partial`, 'manual-backup', 'reyunplex-2026-09-01T00-00-00-000Z',
  ].sort())
  expect(await readFile(join(root, '.reyunplex-root.json'), 'utf8')).toContain('reyunplex')
})
