import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readdir, lstat, readFile, writeFile, copyFile, rename, rm, chmod, realpath } from 'node:fs/promises'
import { dirname, join, relative, isAbsolute } from 'node:path'
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
async function inspectDb(root) {
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
async function assertRoot(root) {
  const stat = await lstat(root)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Data root must be a real directory')
}
function assertOutside(parent, child) {
  const path = relative(parent, child)
  if (!path || (!path.startsWith('..' + '/') && path !== '..' && !isAbsolute(path))) throw new Error('Backup and application data must be separate directories')
}
export async function backup(dataDir, outputDir, appVersion) {
  const source = await realpath(dataDir)
  await assertRoot(dataDir)
  await mkdir(outputDir, { recursive: true, mode: 0o700 })
  const output = await realpath(outputDir)
  assertOutside(source, output)
  const id = new Date().toISOString().replace(/[:.]/g, '-')
  const target = join(output, `reyunplex-${id}`), staging = `${target}.partial`
  await mkdir(join(staging, 'data'), { recursive: true, mode: 0o700 })
  try {
    const manifest = { format: 1, appVersion, createdAt: new Date().toISOString(), databaseVersion: await inspectDb(source), files: [] }
    for (const path of await files(source)) {
      const destination = join(staging, 'data', safePath(path))
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
      await copyFile(join(source, path), destination)
      await chmod(destination, 0o600)
      manifest.files.push({ path, sha256: await digest(destination), size: (await lstat(destination)).size })
    }
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
  await verify(bundleDir)
  await assertRoot(dataDir)
  const target = await realpath(dataDir), bundle = await realpath(bundleDir)
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
    const manifest = JSON.parse(await readFile(join(bundle, 'manifest.json'), 'utf8'))
    for (const entry of manifest.files) if (await digest(join(staging, entry.path)) !== entry.sha256) throw new Error('Staged backup checksum mismatch')
    await inspectDb(staging)
    await rename(target, previous); moved = true
    await rename(staging, target)
    return previous
  } catch (error) {
    if (moved) await rename(previous, target)
    await rm(staging, { recursive: true, force: true })
    throw error
  }
}
