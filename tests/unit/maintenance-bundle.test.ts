import { afterEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises'
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
