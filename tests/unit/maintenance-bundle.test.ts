import { afterEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, copyFile, readdir, lstat, access } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { backup, restore, verify } from '../../scripts/maintenance/bundle.mjs'
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'reyunplex-maintenance-')); roots.push(root)
  const data = join(root, 'data'); await mkdir(data)
  const db = new Database(join(data, 'data.db'))
  db.exec("CREATE TABLE config (value TEXT); CREATE TABLE auth_admin (id INTEGER); INSERT INTO config VALUES ('original'); PRAGMA user_version=7")
  db.close()
  await writeFile(join(data, 'private-config'), 'private-test-only')
  return { root, data }
}
it('backs up, verifies, restores application facts and retains the pre-restore directory', async () => {
  const { root, data } = await fixture()
  const bundle = await backup(data, join(root, 'backups'), 'test-release')
  expect(await verify(bundle)).toMatchObject({ appVersion: 'test-release', databaseVersion: 7 })
  const db = new Database(join(data, 'data.db')); db.exec("UPDATE config SET value='changed'"); db.close()
  const previous = await restore(bundle, data)
  const restored = new Database(join(data, 'data.db')); expect(restored.prepare('SELECT value FROM config').pluck().get()).toBe('original'); restored.close()
  const kept = new Database(join(previous, 'data.db')); expect(kept.prepare('SELECT value FROM config').pluck().get()).toBe('changed'); kept.close()
})
it('rejects corrupt backups before changing application data', async () => {
  const { root, data } = await fixture()
  const bundle = await backup(data, join(root, 'backups'), 'test-release')
  await writeFile(join(bundle, 'data', 'private-config'), 'corrupt')
  await expect(restore(bundle, data)).rejects.toThrow('checksum')
  expect(await readFile(join(data, 'private-config'), 'utf8')).toBe('private-test-only')
})
it('rejects traversal, extra members and symbolic links', async () => {
  const { root, data } = await fixture()
  const bundle = await backup(data, join(root, 'backups'), 'test-release')
  const manifestPath = join(bundle, 'manifest.json'), manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.files[0].path = '../escape'
  await writeFile(manifestPath, JSON.stringify(manifest))
  await expect(verify(bundle)).rejects.toThrow('member path')
  await symlink(join(data, 'private-config'), join(data, 'link'))
  await expect(backup(data, join(root, 'other'), 'test-release')).rejects.toThrow('Symbolic')
})

async function fingerprints(root: string) {
  const result: Record<string, string> = {}
  for (const file of await readdir(root)) {
    if ((await lstat(join(root, file))).isFile()) result[file] = createHash('sha256').update(await readFile(join(root, file))).digest('hex')
  }
  return result
}

it('checks WAL snapshots repeatedly without modifying the source or backup members', async () => {
  const { root, data } = await fixture()
  const db = new Database(join(data, 'data.db'))
  db.pragma('journal_mode = WAL'); db.pragma('wal_autocheckpoint = 0')
  db.exec("UPDATE config SET value='committed-in-wal'")
  const snapshot = join(root, 'snapshot'); await mkdir(snapshot)
  for (const file of await readdir(data)) await copyFile(join(data, file), join(snapshot, file))
  db.close()
  expect(await readdir(snapshot)).toContain('data.db-wal')
  const before = await fingerprints(snapshot)
  const bundle = await backup(snapshot, join(root, 'backups'), 'wal-release')
  expect(await fingerprints(snapshot)).toEqual(before)
  const hashes = await fingerprints(join(bundle, 'data'))
  await verify(bundle); await verify(bundle)
  expect(await fingerprints(join(bundle, 'data'))).toEqual(hashes)
  const target = join(root, 'restored'); await mkdir(target)
  await restore(bundle, target)
  const restored = new Database(join(target, 'data.db'))
  try { expect(restored.prepare('SELECT value FROM config').pluck().get()).toBe('committed-in-wal') } finally { restored.close() }
  expect((await lstat(join(target, 'data.db'))).uid).toBe((await lstat(target)).uid)
})

it('rejects nested and symlinked output before creating anything in application data', async () => {
  const { root, data } = await fixture()
  await expect(backup(data, join(data, 'backups', 'new'), 'test')).rejects.toThrow('separate directories')
  await expect(access(join(data, 'backups'))).rejects.toThrow()
  const alias = join(root, 'alias'); await symlink(data, alias)
  await expect(backup(data, join(alias, 'nested'), 'test')).rejects.toThrow('separate directories')
  await expect(access(join(data, 'nested'))).rejects.toThrow()
})
