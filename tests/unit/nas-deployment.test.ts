import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, writeFile, mkdir, readdir, rm, lstat, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { deploy, deploymentConfig } from '../../scripts/deploy/nas-deploy.mjs'
import { hostOperation } from '../../scripts/deploy/host-state.mjs'
import { backup, verify } from '../../scripts/maintenance/bundle.mjs'

const roots: string[] = []
const revision = 'a'.repeat(40), previousRevision = 'b'.repeat(40)
const variables = { REYUNPLEX_IMAGE: `reyunplex:${revision}`, REYUNPLEX_REVISION: revision, NAS_APP_ROOT: '/volume1/docker/reyunplex', NAS_MUSIC_DIR: '/volume1/music', NAS_UID: '1000', NAS_GID: '1000' }
const config = () => deploymentConfig(variables)
const owner = () => ({ uid: process.getuid!(), gid: process.getgid!() })
afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function directory() {
  const root = await mkdtemp(join(tmpdir(), 'reyunplex-deployment-')); roots.push(root)
  return join(root, 'reyunplex')
}
async function state(root: string) { return JSON.parse(await readFile(join(root, 'deployment.json'), 'utf8')) }

it('requires a full SHA, a dedicated NAS directory, separate media and a non-root user', () => {
  expect(config()).toMatchObject({ port: 3000, uid: 1000, gid: 1000, memory: '1g', cpus: '2' })
  const valid = variables
  for (const patch of [
    { REYUNPLEX_IMAGE: 'reyunplex:latest' }, { REYUNPLEX_REVISION: 'short' },
    { NAS_APP_ROOT: '/volume1/docker' }, { NAS_APP_ROOT: './data' },
    { NAS_MUSIC_DIR: '/volume1/docker/reyunplex/data' }, { NAS_MUSIC_DIR: '/volume1/music/../docker' },
    { NAS_APP_ROOT: '' }, { NAS_MUSIC_DIR: '' }, { NAS_UID: '' }, { NAS_GID: '' },
    { NAS_MEMORY: '-1g' }, { NAS_CPUS: 'unlimited' }, { NAS_UID: '0' }, { NAS_GID: '-1' }, { NAS_PORT: '65536' }, { NAS_BIND_ADDRESS: '1.2.3.4' },
  ]) expect(() => deploymentConfig({ ...valid, ...patch })).toThrow()
})

it('initializes empty managed data once and leaves data and saved ownership intact on retry', async () => {
  const root = await directory()
  expect(await hostOperation({ action: 'prepare', ...owner() }, root)).toEqual({ previous: null, hasDatabase: false })
  await writeFile(join(root, 'data', 'data.db'), 'disposable-test-content')
  await hostOperation({ action: 'checkpoint', state: { status: 'ready', revision } }, root)
  expect(await hostOperation({ action: 'prepare', ...owner() }, root)).toEqual({ previous: { status: 'ready', revision }, hasDatabase: true })
  await expect(hostOperation({ action: 'prepare', uid: owner().uid + 1, gid: owner().gid }, root)).rejects.toThrow('ownership')
  expect(await readFile(join(root, 'data', 'data.db'), 'utf8')).toBe('disposable-test-content')
  expect((await lstat(join(root, 'deployment.json'))).mode & 0o777).toBe(0o600)
})

it('refuses unmanaged existing data, symlinked roots and interrupted deployments', async () => {
  const root = await directory(); await mkdir(root)
  await writeFile(join(root, 'important'), 'keep-me')
  await expect(hostOperation({ action: 'prepare', ...owner() }, root)).rejects.toThrow('nonempty')
  expect(await readdir(root)).toEqual(['important'])
  const alias = `${root}-alias`; await symlink(root, alias)
  await expect(hostOperation({ action: 'prepare', ...owner() }, alias)).rejects.toThrow('real application directory')
  const managed = await directory(); await hostOperation({ action: 'prepare', ...owner() }, managed)
  await hostOperation({ action: 'checkpoint', state: { status: 'starting', revision } }, managed)
  await expect(hostOperation({ action: 'prepare', ...owner() }, managed)).rejects.toThrow('interrupted deployment')
})

type FakeContainer = {
  Id: string; Image: string; Config: { Labels: Record<string, string> }
  State: { Running: boolean; Status: string; ExitCode: number }
  Mounts: { Type: string; Source: string; Destination: string; RW: boolean }[]
}
type Options = { input?: string; allowFailure?: boolean }
async function harness(options: { existing?: boolean; ready?: boolean; backupFails?: boolean; helperStopFails?: boolean; lockExists?: boolean; stopFails?: boolean; oldData?: string; imageRevision?: string; competitor?: boolean } = {}) {
  const root = await directory(), settings = config(), calls: string[][] = []
  const data = join(root, 'data')
  let current: FakeContainer | null = null
  let helperRunning = false
  if (options.existing) {
    await hostOperation({ action: 'prepare', ...owner() }, root)
    const db = new Database(join(data, 'data.db'))
    db.exec("CREATE TABLE config(value TEXT); CREATE TABLE auth_admin(id INTEGER); INSERT INTO config VALUES('old-settings')")
    db.close()
    await hostOperation({ action: 'checkpoint', state: { status: 'ready', revision: previousRevision } }, root)
    current = {
      Id: 'old-container', Image: 'sha256:previous-image', Config: { Labels: { 'com.docker.compose.project': 'reyunplex' } },
      State: { Running: true, Status: 'running', ExitCode: 0 },
      Mounts: [{ Type: 'bind', Source: options.oldData ?? `${settings.root}/data`, Destination: '/app/data', RW: true }],
    }
  }
  const competitor = {
    Id: 'other-container', Image: 'other', Config: { Labels: {} },
    State: { Running: true, Status: 'running', ExitCode: 0 },
    Mounts: [{ Type: 'bind', Source: `${settings.root}/data`, Destination: '/other', RW: true }],
  }
  const run = async (args: string[], io: Options = {}) => {
    calls.push(args)
    if (args[0] === 'info') return JSON.stringify({ OSType: 'linux', Architecture: 'x86_64' })
    if (args[0] === 'image' && args[1] === 'ls') return ''
    if (args[0] === 'image') return JSON.stringify([{ Os: 'linux', Architecture: 'amd64', Config: { Labels: { 'org.opencontainers.image.revision': options.imageRevision ?? revision } } }])
    if (args[0] === 'create') { if (options.lockExists) throw new Error('deployment lock already exists'); return 'lock-id' }
    if (args[0] === 'container') {
      if (args[2]?.startsWith('reyunplex-deploy-helper-')) return helperRunning ? JSON.stringify({ State: { Running: true } }) : null
      const target = args[2] === 'other-container' ? competitor : current
      return target ? JSON.stringify(target) : null
    }
    if (args[0] === 'ps') return options.competitor ? 'other-container' : ''
    if (args[0] === 'run' && io.input) {
      const payload = JSON.parse(args.at(-1)!)
      if (payload.action === 'backup' && options.backupFails) helperRunning = true
      const result = await hostOperation({ ...payload, ...owner() }, root, {
        backup: options.backupFails ? async () => { throw new Error('backup disk full') } : backup,
      })
      return JSON.stringify(result)
    }
    if (args[0] === 'rm' && args.at(-1)?.startsWith('reyunplex-deploy-helper-')) {
      if (options.helperStopFails && helperRunning) return null
      helperRunning = false
      return ''
    }
    if (args[0] === 'stop') {
      if (options.stopFails && current?.Id === 'new-container') return null
      if (current) Object.assign(current.State, { Running: false, Status: 'exited' })
      return 'stopped'
    }
    if (args[0] === 'start') {
      if (current) Object.assign(current.State, { Running: true, Status: 'running' })
      return 'started'
    }
    if (args[0] === 'compose' && args.includes('up')) {
      const db = new Database(join(data, 'data.db'))
      db.exec('CREATE TABLE candidate_migration(id INTEGER)')
      db.close()
      current = {
        Id: 'new-container', Image: 'sha256:candidate-image', Config: { Labels: { 'com.docker.compose.project': 'reyunplex' } },
        State: { Running: true, Status: 'running', ExitCode: 0 }, Mounts: [],
      }
      return 'started'
    }
    if (args[0] === 'exec') return options.ready === false ? null : ''
    return ''
  }
  const dependencies = { docker: run, sleep: async () => {}, isForward: async () => true }
  vi.spyOn(console, 'error').mockImplementation(() => {})
  return { root, data, settings, calls, dependencies, current: () => current }
}

it('deploys a fresh database and persists host Compose settings without any data backup', async () => {
  const h = await harness()
  expect(await deploy(h.settings, h.dependencies)).toMatchObject({ image: h.settings.image, backup: null, port: 3000 })
  expect(await state(h.root)).toMatchObject({ status: 'ready', revision, previousImage: null })
  expect(await readFile(join(h.root, '.env'), 'utf8')).toContain('NAS_APP_ROOT=/volume1/docker/reyunplex')
  expect(h.calls.some(args => args[0] === 'rm' && args[1] === 'reyunplex-deploy-lock')).toBe(true)
  expect(h.calls.filter(args => args[0] === 'run' && args.includes('-i')).every(args => args.includes('--network') && args.includes('none'))).toBe(true)
  const helpers = h.calls.filter(args => args[0] === 'run' && args.includes('-i'))
  expect(helpers.filter(args => !args.at(-1)?.includes('"action":"prepare"')).every(args => args.includes(`type=bind,source=${h.settings.root},target=/application`))).toBe(true)
})

it('backs up stopped data before candidate startup and preserves the old settings', async () => {
  const h = await harness({ existing: true })
  await deploy(h.settings, h.dependencies)
  const saved = await state(h.root)
  expect(saved).toMatchObject({ status: 'ready', previousImage: 'sha256:previous-image' })
  const bundle = join(h.root, saved.backup)
  expect(await verify(bundle)).toMatchObject({ appVersion: 'sha256:previous-image' })
  const db = new Database(join(bundle, 'data', 'data.db'))
  try {
    expect(db.prepare('SELECT value FROM config').pluck().get()).toBe('old-settings')
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='candidate_migration'").get()).toBeUndefined()
  } finally { db.close() }
  const stop = h.calls.findIndex(args => args[0] === 'stop')
  const snapshot = h.calls.findIndex(args => args[0] === 'run' && args.at(-1)?.includes('"action":"backup"'))
  const start = h.calls.findIndex(args => args[0] === 'compose' && args.includes('up'))
  expect(stop).toBeLessThan(snapshot); expect(snapshot).toBeLessThan(start)
})

it('restarts the untouched old instance if backup fails and does not start the candidate', async () => {
  const h = await harness({ existing: true, backupFails: true })
  await expect(deploy(h.settings, h.dependencies)).rejects.toThrow('backup disk full')
  expect(h.current()?.State.Running).toBe(true)
  expect(await state(h.root)).toMatchObject({ status: 'failed-before-start' })
  expect(h.calls.some(args => args[0] === 'compose' && args.includes('up'))).toBe(false)
  const remove = h.calls.findIndex(args => args[0] === 'rm' && args.at(-1)?.startsWith('reyunplex-deploy-helper-'))
  expect(remove).toBeGreaterThan(-1)
  expect(remove).toBeLessThan(h.calls.findIndex(args => args[0] === 'start'))
})

it('keeps the old application stopped and retains the lock if a timed-out backup helper cannot be removed', async () => {
  const h = await harness({ existing: true, backupFails: true, helperStopFails: true })
  await expect(deploy(h.settings, h.dependencies)).rejects.toThrow('backup disk full')
  expect(h.current()?.State.Running).toBe(false)
  expect(h.calls.some(args => args[0] === 'start' || (args[0] === 'rm' && args[1] === 'reyunplex-deploy-lock'))).toBe(false)
  expect(await state(h.root)).toMatchObject({ status: 'failed-stop' })
})

it('stops a failed candidate without rolling back migrated data or restarting the old image', async () => {
  const h = await harness({ existing: true, ready: false })
  await expect(deploy(h.settings, h.dependencies)).rejects.toThrow('did not become ready')
  expect(h.calls.filter(args => args[0] === 'exec')).toHaveLength(60)
  expect(h.current()?.State.Running).toBe(false)
  expect(h.calls.some(args => args[0] === 'start')).toBe(false)
  expect(await state(h.root)).toMatchObject({ status: 'failed' })
  const db = new Database(join(h.data, 'data.db'))
  try { expect(db.prepare("SELECT name FROM sqlite_master WHERE name='candidate_migration'").get()).toBeDefined() } finally { db.close() }
})

it('keeps the deployment lock if the failed candidate cannot be stopped', async () => {
  const h = await harness({ existing: true, ready: false, stopFails: true })
  await expect(deploy(h.settings, h.dependencies)).rejects.toThrow()
  expect(h.current()?.State.Running).toBe(true)
  expect(await state(h.root)).toMatchObject({ status: 'failed-stop' })
  expect(h.calls.some(args => args[0] === 'rm' && args[1] === 'reyunplex-deploy-lock')).toBe(false)
})

it.each([
  { lockExists: true }, { imageRevision: previousRevision },
  { oldData: '/volume1/docker/different/data', existing: true }, { competitor: true },
])('rejects collisions, wrong revisions and shared data before stopping any application: %j', async options => {
  const h = await harness(options)
  await expect(deploy(h.settings, h.dependencies)).rejects.toThrow()
  expect(h.calls.some(args => args[0] === 'stop' || args[0] === 'start')).toBe(false)
  expect(h.calls.some(args => args[0] === 'compose' && args.includes('up'))).toBe(false)
  if (options.lockExists) expect(h.calls.some(args => args[0] === 'rm')).toBe(false)
})

it('rejects a late older workflow before stopping the newer deployment', async () => {
  const h = await harness({ existing: true })
  await expect(deploy(h.settings, { ...h.dependencies, isForward: async () => false })).rejects.toThrow('only moves forward')
  expect(h.current()?.State.Running).toBe(true)
  expect(h.calls.some(args => args[0] === 'stop' || args[0] === 'start')).toBe(false)
  expect(await state(h.root)).toMatchObject({ revision: previousRevision })
})
