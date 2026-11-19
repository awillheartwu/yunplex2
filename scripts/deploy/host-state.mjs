// Initial preparation mounts the Docker parent to create the app directory.
// Later operations mount only that directory, never music or other apps.
import { mkdir, readdir, readFile, writeFile, rename, lstat, chown, chmod, realpath, rm } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { randomUUID } from 'node:crypto'

async function readJson(file) {
  try { return JSON.parse(await readFile(file, 'utf8')) } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}
async function atomicWrite(file, content) {
  const temporary = `${file}.${randomUUID()}.partial`
  await writeFile(temporary, content, { mode: 0o600, flag: 'wx' })
  await rename(temporary, file)
}
async function realDirectory(path) {
  const stat = await lstat(path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Expected a real application directory')
}

export async function hostOperation(input, root, dependencies = {}) {
  const markerFile = join(root, '.reyunplex-root.json')
  const stateFile = join(root, 'deployment.json')
  const data = join(root, 'data')
  if (input.action === 'prepare') {
    await mkdir(root, { recursive: true, mode: 0o700 })
    await realDirectory(root)
    let marker = await readJson(markerFile)
    if (!marker) {
      if ((await readdir(root)).length) throw new Error('Refusing to adopt a nonempty unmanaged directory; first installation requires fresh data')
      marker = { format: 1, application: 'reyunplex', uid: input.uid, gid: input.gid }
      await atomicWrite(markerFile, JSON.stringify(marker))
      await mkdir(data, { mode: 0o700 })
      await chown(root, input.uid, input.gid)
      await chown(markerFile, input.uid, input.gid)
      await chown(data, input.uid, input.gid)
    }
    if (marker.format !== 1 || marker.application !== 'reyunplex' || marker.uid !== input.uid || marker.gid !== input.gid) throw new Error('Application directory identity or ownership does not match')
    await realDirectory(data)
    const ownership = await lstat(data)
    if (ownership.uid !== input.uid || ownership.gid !== input.gid) throw new Error('Application data ownership changed; correct it explicitly before deployment')
    await mkdir(join(root, 'backups'), { mode: 0o700, recursive: true })
    await realDirectory(join(root, 'backups'))
    await chown(join(root, 'backups'), input.uid, input.gid)
    const previous = await readJson(stateFile)
    if (previous && !['ready', 'failed', 'failed-before-start'].includes(previous.status)) throw new Error('An interrupted deployment needs inspection before retrying')
    return { previous, hasDatabase: (await readdir(data)).includes('data.db') }
  }
  const marker = await readJson(markerFile)
  if (marker?.application !== 'reyunplex' || marker.format !== 1) throw new Error('Missing application directory identity')
  if (input.action === 'checkpoint') {
    if (input.compose !== undefined) {
      await atomicWrite(join(root, 'compose.yml'), input.compose)
      await atomicWrite(join(root, '.env'), input.environment)
    }
    await atomicWrite(stateFile, JSON.stringify(input.state, null, 2))
    return { saved: true }
  }
  if (input.action === 'backup') {
    const backup = dependencies.backup ?? (await import('/app/maintenance/bundle.mjs')).backup
    const bundle = await backup(data, join(root, 'backups'), input.previousImage)
    await chmod(bundle, 0o700)
    return { bundle: relative(await realpath(root), bundle) }
  }
  if (input.action === 'retain') {
    const directory = join(root, 'backups')
    await realDirectory(directory)
    const candidates = []
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^reyunplex-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/.test(entry.name)) continue
      const manifest = await readJson(join(directory, entry.name, 'manifest.json'))
      if (manifest?.format === 1 && typeof manifest.appVersion === 'string' && Array.isArray(manifest.files)) candidates.push(entry.name)
    }
    candidates.sort().reverse()
    const keep = new Set(candidates.slice(0, input.keep))
    for (const name of candidates) {
      if (!keep.has(name) && `backups/${name}` !== input.backup) await rm(join(directory, name), { recursive: true })
    }
    return { retained: true }
  }
  throw new Error('Unsupported deployment state operation')
}

if (process.argv[1] === '-') {
  process.umask(0o077)
  try {
    const input = JSON.parse(process.argv[2])
    const root = input.action === 'prepare' ? '/nas-parent/reyunplex' : '/application'
    console.log(JSON.stringify(await hostOperation(input, root)))
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Deployment state operation failed')
    process.exitCode = 1
  }
}
