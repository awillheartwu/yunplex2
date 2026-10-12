import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { pruneImages } from './retention.mjs'

const execute = promisify(execFile)
const composeFile = fileURLToPath(new URL('../../deploy/nas.compose.yml', import.meta.url))
const helperFile = new URL('./host-state.mjs', import.meta.url)
const CONTAINER = 'reyunplex'
const LOCK = 'reyunplex-deploy-lock'

export function deploymentConfig(env) {
  const config = {
    image: env.REYUNPLEX_IMAGE,
    revision: env.REYUNPLEX_REVISION,
    root: env.NAS_APP_ROOT,
    music: env.NAS_MUSIC_DIR?.replace(/\/+$/, ''),
    address: env.NAS_BIND_ADDRESS || '0.0.0.0',
    port: Number(env.NAS_PORT || 3000),
    uid: Number(env.NAS_UID), gid: Number(env.NAS_GID),
    memory: env.NAS_MEMORY || '1g', cpus: env.NAS_CPUS || '2',
  }
  for (const key of ['NAS_APP_ROOT', 'NAS_MUSIC_DIR', 'NAS_UID', 'NAS_GID']) if (!env[key]) throw new Error(`Set the repository variable ${key}`)
  if (!/^[a-f0-9]{40}$/.test(config.revision ?? '') || config.image !== `reyunplex:${config.revision}`) throw new Error('A full commit SHA and matching reyunplex image tag are required')
  if (!/^\/volume\d+\/docker\/reyunplex$/.test(config.root)) throw new Error('Use a dedicated /volumeN/docker/reyunplex application directory')
  if (!/^\/volume\d+\/[\w./-]+$/.test(config.music) || resolve(config.music) !== config.music || config.music.startsWith(`${dirname(config.root)}/`) || config.music === dirname(config.root)) throw new Error('Music must be a separate absolute NAS directory')
  if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) throw new Error('Invalid LAN port')
  for (const id of [config.uid, config.gid]) if (!Number.isInteger(id) || id < 1 || id > 2147483647) throw new Error('A non-root runtime UID and GID are required')
  if (!/^[1-9]\d*[mg]$/.test(config.memory) || !Number.isFinite(Number(config.cpus)) || Number(config.cpus) <= 0) throw new Error('Invalid NAS_MEMORY or NAS_CPUS resource limit')
  const octets = config.address.split('.').map(Number)
  if (octets.length !== 4 || octets.some(n => !Number.isInteger(n) || n < 0 || n > 255) || (config.address !== '0.0.0.0' && octets[0] !== 10 && !(octets[0] === 192 && octets[1] === 168) && !(octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31))) throw new Error('Bind to a LAN IPv4 address or 0.0.0.0')
  return config
}

export function composeEnvironment(config) {
  return {
    REYUNPLEX_IMAGE: config.image, NAS_APP_ROOT: config.root,
    NAS_MUSIC_DIR: config.music, NAS_BIND_ADDRESS: config.address,
    NAS_PORT: String(config.port), NAS_UID: String(config.uid), NAS_GID: String(config.gid),
    NAS_MEMORY: config.memory, NAS_CPUS: config.cpus,
  }
}

export async function docker(args, options = {}) {
  try {
    const pending = execute('docker', args, {
      encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
      timeout: options.timeout ?? 60_000, env: options.env ?? process.env,
    })
    pending.child.stdin.end(options.input)
    const { stdout, stderr } = await pending
    return (args[0] === 'logs' ? stdout + stderr : stdout).trim()
  } catch (error) {
    if (options.allowFailure) return null
    throw new Error(`Docker ${args[0]} failed (${error.code ?? 'interrupted'})`, { cause: error })
  }
}

// Ask Docker only for fields used here; never read other containers' credentials.
export async function inspect(run, name) {
  const fields = '{"Id":{{json .Id}},"Image":{{json .Image}},"Config":{"Labels":{{json .Config.Labels}}},"State":{{json .State}},"Mounts":{{json .Mounts}}}'
  const result = await run(['container', 'inspect', name, '--format', fields], { allowFailure: true })
  return result === null ? null : JSON.parse(result)
}
function sharesData(container, data) {
  return (container.Mounts ?? []).some(mount => mount.Type === 'bind' && mount.RW !== false && (mount.Source === data || data.startsWith(`${mount.Source}/`) || mount.Source.startsWith(`${data}/`)))
}

export async function deploy(config, dependencies = {}) {
  const run = dependencies.docker ?? docker
  const wait = dependencies.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const interrupted = dependencies.interrupted ?? (() => false)
  const environment = { ...process.env, ...composeEnvironment(config) }
  const compose = (...args) => run(['compose', '-p', 'reyunplex', '-f', composeFile, ...args], { env: environment, timeout: 180_000 })
  const helperSource = await readFile(helperFile, 'utf8')
  const helperName = `reyunplex-deploy-helper-${randomUUID()}`
  const helper = async input => JSON.parse(await run([
    'run', '--rm', '-i', '--name', helperName, '--network', 'none', '--memory', '256m', '--memory-swap', '256m', '--cpus', '1', '--tmpfs', '/app/data', '--user', input.action === 'prepare' ? '0:0' : `${config.uid}:${config.gid}`,
    '--mount', input.action === 'prepare'
      ? `type=bind,source=${dirname(config.root)},target=/nas-parent`
      : `type=bind,source=${config.root},target=/application`,
    '--entrypoint', 'node', config.image, '--input-type=module', '-', JSON.stringify(input),
  ], { input: helperSource, timeout: 300_000 }))
  const removeHelper = async () => {
    await run(['rm', '-f', '-v', helperName], { allowFailure: true })
    if (await inspect(run, helperName)) throw new Error('Deployment helper could not be removed')
  }
  const checkInterrupted = () => { if (interrupted()) throw new Error('Deployment interrupted') }
  const waitReady = async () => {
    const deadline = Date.now() + 120_000
    for (let attempt = 0; attempt < 60 && Date.now() < deadline; attempt++) {
      checkInterrupted()
      const result = await run(['exec', CONTAINER, 'node', '-e', "fetch('http://127.0.0.1:3000/api/system/ready',{signal:AbortSignal.timeout(3000)}).then(async r=>{const v=await r.json();process.exit(r.ok&&v.code===0&&v.data?.ready===true?0:1)}).catch(()=>process.exit(1))"], { allowFailure: true, timeout: 5000 })
      if (result !== null) return
      await wait(2000)
    }
    throw new Error('Application did not become ready within the bounded wait')
  }

  let lock = false, prepared = false, old = null, candidateAttempted = false, oldStopRequested = false, safeToUnlock = true
  let state = { status: 'prepared', revision: config.revision, image: config.image, previousImage: null, backup: null, startedAt: new Date().toISOString() }
  const checkpoint = async status => {
    state = { ...state, status }
    await helper({ action: 'checkpoint', state })
  }
  try {
    const info = JSON.parse(await run(['info', '--format', '{{json .}}']))
    if (info.OSType !== 'linux' || !['x86_64', 'amd64'].includes(info.Architecture)) throw new Error('Deployment requires the x86_64 NAS Docker daemon')
    await compose('config', '--quiet')
    const image = JSON.parse(await run(['image', 'inspect', config.image]))[0]
    if (image.Config?.Labels?.['org.opencontainers.image.revision'] !== config.revision || image.Os !== 'linux' || image.Architecture !== 'amd64') throw new Error('Image revision or architecture does not match the deployment')
    await run(['create', '--name', LOCK, '--network', 'none', '--tmpfs', '/app/data', '--label', `reyunplex.revision=${config.revision}`, '--entrypoint', 'node', config.image, '-e', 'process.exit(0)'])
    lock = true
    // --mount refuses missing NAS paths; it cannot create a directory on an
    // accidental Docker daemon or confuse the job workspace with the NAS.
    await run(['run', '--rm', '--network', 'none', '--user', `${config.uid}:${config.gid}`, '--mount', `type=bind,source=${config.music},target=/music`, '--entrypoint', 'node', config.image, '-e', "require('node:fs').accessSync('/music',require('node:fs').constants.R_OK|require('node:fs').constants.W_OK)"])
    old = await inspect(run, CONTAINER)
    if (old && old.Config?.Labels?.['com.docker.compose.project'] !== 'reyunplex') throw new Error('Refusing to replace an unmanaged container')
    if (old && !(old.Mounts ?? []).some(mount => mount.Type === 'bind' && mount.Destination === '/app/data' && mount.Source === `${config.root}/data`)) throw new Error('Existing container uses a different data directory')
    const containers = (await run(['ps', '-aq'])).split(/\s+/).filter(Boolean)
    for (const id of containers) {
      const other = await inspect(run, id)
      if (other?.State.Running && other.Id !== old?.Id && sharesData(other, `${config.root}/data`)) throw new Error('Another running container uses application data')
    }
    const existing = await helper({ action: 'prepare', uid: config.uid, gid: config.gid })
    if (existing.hasDatabase && !old) throw new Error('Existing database has no managed container; inspect it before adopting it')
    if (existing.previous?.revision && existing.previous.revision !== config.revision) {
      if (!/^[a-f0-9]{40}$/.test(existing.previous.revision)) throw new Error('Invalid previous deployment revision')
      const forward = dependencies.isForward ?? (async (previous, next) => {
        try {
          await execute('git', ['merge-base', '--is-ancestor', previous, next], { cwd: fileURLToPath(new URL('../../', import.meta.url)) })
          return true
        } catch { return false }
      })
      if (!await forward(existing.previous.revision, config.revision)) throw new Error('Refusing an older or divergent commit; automatic deployment only moves forward')
    }
    state.previousImage = old?.Image ?? null
    checkInterrupted()
    prepared = true
    await checkpoint('prepared')
    if (old) {
      oldStopRequested = true
      await run(['stop', '--time', '120', CONTAINER], { timeout: 135_000 })
      const stopped = await inspect(run, CONTAINER)
      if (!stopped || stopped.State.Running) throw new Error('Old application did not stop')
    }
    await checkpoint('stopped')
    if (existing.hasDatabase) {
      const result = await helper({ action: 'backup', previousImage: state.previousImage })
      state.backup = result.bundle
      await checkpoint('backed_up')
    }
    checkInterrupted()
    const installedEnvironment = Object.entries(composeEnvironment(config)).map(([key, value]) => `${key}=${value}`).join('\n') + '\n'
    await helper({ action: 'checkpoint', state: { ...state, status: 'starting' }, compose: await readFile(composeFile, 'utf8'), environment: installedEnvironment })
    candidateAttempted = true
    await compose('up', '-d', '--no-build', 'yunplex2')
    await waitReady()
    await checkpoint('ready')
    // Cleanup must not turn an already healthy deployment into a failed one.
    try {
      await helper({ action: 'retain', keep: 3, backup: state.backup })
      await pruneImages(run, [state.previousImage])
    } catch { console.error('Deployment ready; retention cleanup failed, inspect disk usage') }
    return { image: config.image, backup: state.backup, port: config.port }
  } catch (error) {
    // A timed-out attached CLI can leave the backup helper running. End it
    // before allowing the old application to write to the source again.
    if (lock) await removeHelper().catch(() => { safeToUnlock = false })
    if (candidateAttempted) {
      // New code may already have migrated SQLite or touched Plex/media.
      // Do not restore a database or restart an older image automatically.
      const stopped = await run(['stop', '--time', '120', CONTAINER], { allowFailure: true, timeout: 135_000 })
      const current = await inspect(run, CONTAINER).catch(() => null)
      safeToUnlock = safeToUnlock && stopped !== null && (!current || !current.State.Running)
    } else if (old?.State.Running && oldStopRequested && safeToUnlock) {
      await run(['start', CONTAINER], { allowFailure: true })
    }
    if (prepared) await checkpoint(!safeToUnlock ? 'failed-stop' : candidateAttempted ? 'failed' : 'failed-before-start').catch(() => { safeToUnlock = false })
    const current = await inspect(run, CONTAINER).catch(() => null)
    if (current) console.error(JSON.stringify({ container: CONTAINER, image: current.Image, status: current.State.Status, exitCode: current.State.ExitCode, backup: state.backup }))
    throw error
  } finally {
    if (lock) {
      // An attached CLI timeout can leave its helper running in Docker.
      await removeHelper().catch(() => { safeToUnlock = false })
      if (safeToUnlock) await run(['rm', LOCK], { allowFailure: true })
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let interrupted = false
  process.on('SIGINT', () => { interrupted = true })
  process.on('SIGTERM', () => { interrupted = true })
  try {
    const config = deploymentConfig(process.env)
    const ancestors = process.env.REYUNPLEX_ANCESTORS_FILE
      ? new Set((await readFile(process.env.REYUNPLEX_ANCESTORS_FILE, 'utf8')).trim().split('\n')) : null
    const result = await deploy(config, {
      interrupted: () => interrupted,
      ...(ancestors ? { isForward: async (previous, next) => next === config.revision && ancestors.has(previous) } : {}),
    })
    console.log(`Deployment ready: ${result.image}; LAN port ${result.port}; backup ${result.backup ?? 'first installation'}`)
  } catch (error) {
    console.error(`Deployment failed: ${error instanceof Error ? error.message : 'unknown error'}`)
    process.exitCode = 1
  }
}
