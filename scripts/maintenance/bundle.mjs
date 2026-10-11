import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, mkdtemp, readdir, lstat, readFile, writeFile, copyFile, rename, rm, chmod, chown, realpath, statfs } from 'node:fs/promises'
import { dirname, join, relative, isAbsolute, resolve, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
function sqlite() {
  try { return require('better-sqlite3') } catch { return createRequire('/app/.output/server/index.mjs')('better-sqlite3') }
}
async function digest(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}
async function files(root, prefix = '') {
  const entries = []
  for (const name of await readdir(join(root, prefix))) {
    const path = join(prefix, name), stat = await lstat(join(root, path))
    if (stat.isSymbolicLink()) throw new Error('Symbolic links are not supported in application backups')
    if (stat.isDirectory()) entries.push(...await files(root, path))
    else if (stat.isFile()) entries.push(path)
    else throw new Error('Unsupported application data entry')
  }
  return entries.sort()
}
function safePath(path) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || path.includes('\\') || path.includes('\0') || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid backup member path')
  return path
}
async function inspectDbCopy(root) {
  const path = join(root, 'data.db')
  if (!(await lstat(path)).isFile()) throw new Error('Missing application database')
  const Database = sqlite(), db = new Database(path, { readonly: true, fileMustExist: true })
  try {
    if (db.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Database integrity check failed')
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name)
    if (!tables.includes('config') || !tables.includes('auth_admin')) throw new Error('Not a reYunPlex database')
    return db.pragma('user_version', { simple: true })
  } finally { db.close() }
}
async function inspectDb(root) {
  // Even readonly SQLite may rebuild WAL shared memory. Never open the source
  // or the checksummed backup directly during validation.
  const scratch = await mkdtemp(join(tmpdir(), 'reyunplex-db-check-'))
  try {
    for (const name of ['data.db', 'data.db-wal', 'data.db-shm']) {
      try {
        const file = join(root, name), stat = await lstat(file)
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Invalid application database member')
        await copyFile(file, join(scratch, name))
      } catch (error) {
        if (error.code !== 'ENOENT' || name === 'data.db') throw error
      }
    }
    return await inspectDbCopy(scratch)
  } finally { await rm(scratch, { recursive: true, force: true }) }
}
async function assertRoot(root) {
  const stat = await lstat(root)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Data root must be a real directory')
}
async function ownTree(root, uid, gid) {
  for (const name of await readdir(root)) {
    const path = join(root, name)
    if ((await lstat(path)).isDirectory()) await ownTree(path, uid, gid)
    else await chown(path, uid, gid)
  }
  await chown(root, uid, gid)
}
function assertOutside(parent, child) {
  const path = relative(parent, child)
  if (!path || (!path.startsWith('..' + '/') && path !== '..' && !isAbsolute(path))) throw new Error('Backup and application data must be separate directories')
}
async function canonicalOutput(path) {
  const absolute = resolve(path)
  try { return await realpath(absolute) } catch (error) {
    if (error.code !== 'ENOENT') throw error
    return join(await canonicalOutput(dirname(absolute)), basename(absolute))
  }
}
export async function backup(dataDir, outputDir, appVersion) {
  const source = await realpath(dataDir)
  await assertRoot(dataDir)
  // Check before mkdir: a rejected output must not alter application data.
  assertOutside(source, await canonicalOutput(outputDir))
  const members = await files(source)
  await mkdir(outputDir, { recursive: true, mode: 0o700 })
  const output = await realpath(outputDir)
  assertOutside(source, output)
  const required = (await Promise.all(members.map(path => lstat(join(source, path))))).reduce((sum, stat) => sum + stat.size, 0)
  const available = await statfs(output)
  if (available.bavail * available.bsize < required + 16 * 1024 * 1024) throw new Error('Insufficient space for application backup')
  const id = new Date().toISOString().replace(/[:.]/g, '-')
  const target = join(output, `reyunplex-${id}`), staging = `${target}.partial`
  await mkdir(join(staging, 'data'), { recursive: true, mode: 0o700 })
  try {
    const manifest = { format: 1, appVersion, createdAt: new Date().toISOString(), databaseVersion: 0, files: [] }
    for (const path of members) {
      const destination = join(staging, 'data', safePath(path))
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
      await copyFile(join(source, path), destination)
      await chmod(destination, 0o600)
      manifest.files.push({ path, sha256: await digest(destination), size: (await lstat(destination)).size })
    }
    manifest.databaseVersion = await inspectDb(join(staging, 'data'))
    await writeFile(join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600, flag: 'wx' })
    await verify(staging)
    await rename(staging, target)
    return target
  } catch (error) { await rm(staging, { recursive: true, force: true }); throw error }
}
export async function verify(bundleDir) {
  await assertRoot(bundleDir)
  const manifestFile = join(bundleDir, 'manifest.json')
  const stat = await lstat(manifestFile)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) throw new Error('Invalid manifest')
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'))
  if (manifest.format !== 1 || !Array.isArray(manifest.files) || typeof manifest.appVersion !== 'string' || !Number.isInteger(manifest.databaseVersion)) throw new Error('Unsupported backup format')
  const root = join(bundleDir, 'data')
  await assertRoot(root)
  const actual = await files(root), expected = manifest.files.map(entry => safePath(entry.path)).sort()
  if (new Set(expected).size !== expected.length || JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Backup member list mismatch')
  for (const entry of manifest.files) {
    const file = join(root, entry.path)
    if ((await lstat(file)).size !== entry.size || await digest(file) !== entry.sha256) throw new Error('Backup checksum mismatch')
  }
  if (await inspectDb(root) !== manifest.databaseVersion) throw new Error('Database version mismatch')
  return manifest
}
export async function restore(bundleDir, dataDir) {
  const manifest = await verify(bundleDir)
  await assertRoot(dataDir)
  const target = await realpath(dataDir), bundle = await realpath(bundleDir)
  const owner = await lstat(target)
  assertOutside(target, bundle); assertOutside(bundle, target)
  const suffix = new Date().toISOString().replace(/[:.]/g, '-')
  const staging = `${target}.restore-${suffix}`, previous = `${target}.before-restore-${suffix}`
  await mkdir(staging, { mode: 0o700 })
  let moved = false
  try {
    for (const path of await files(join(bundle, 'data'))) {
      const destination = join(staging, path)
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
      await copyFile(join(bundle, 'data', path), destination)
      await chmod(destination, 0o600)
    }
    // Validate staged contents again, including their hashes, before touching live data.
    for (const entry of manifest.files) if (await digest(join(staging, entry.path)) !== entry.sha256) throw new Error('Staged backup checksum mismatch')
    await inspectDb(staging)
    // The offline helper can run as root, while the application does not.
    // Preserve the target owner on the new tree, never chown the old live tree.
    await ownTree(staging, owner.uid, owner.gid)
    await rename(target, previous); moved = true
    await rename(staging, target)
    return previous
  } catch (error) {
    if (moved) await rename(previous, target)
    await rm(staging, { recursive: true, force: true })
    throw error
  }
}
