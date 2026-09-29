import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { closeDb, getDb, initDb } from '../../server/lib/db'
import { upgradeSourceRequests } from '../../server/lib/db/source-request-upgrade'

let dataDir = ''
let upgradeDatabase: Database.Database | null = null

afterEach(() => {
  upgradeDatabase?.close()
  upgradeDatabase = null
  closeDb()
  if (dataDir) rmSync(dataDir, { recursive: true, force: true })
  dataDir = ''
})

function columnNames(database: Database.Database, table: string): string[] {
  return (database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(row => row.name)
}

describe('initialization matching schema', () => {
  it('creates matching snapshot columns in a fresh database', () => {
    dataDir = mkdtempSync(join(tmpdir(), 'reyunplex-matching-schema-'))
    initDb(dataDir)

    expect(columnNames(getDb(), 'source_initializations')).toEqual(expect.arrayContaining([
      'rule_version',
      'matching_config_json',
      'matching_config_fingerprint',
      'matching_data_fingerprint',
    ]))
  })

  it('adds upgrade columns repeatedly while preserving existing rows', () => {
    dataDir = mkdtempSync(join(tmpdir(), 'reyunplex-matching-upgrade-'))
    upgradeDatabase = new Database(join(dataDir, 'upgrade.db'))
    const database = upgradeDatabase
    database.exec(`
      CREATE TABLE source_sync_queue (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        schedule_window TEXT NOT NULL,
        status TEXT NOT NULL,
        available_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE source_initializations (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO source_initializations (id, source_id, status, created_at, updated_at)
      VALUES ('old-initialization', 'source-1', 'awaiting_review', 'created', 'updated');
      INSERT INTO source_sync_queue (id, source_id, schedule_window, status, available_at, created_at, updated_at)
      VALUES ('old-request', 'source-1', 'manual:old', 'pending', 'available', 'created', 'updated');
    `)

    const beforeInitialization = database.prepare('SELECT * FROM source_initializations').all()
    const beforeRequest = database.prepare('SELECT * FROM source_sync_queue').all()
    upgradeSourceRequests(database)
    upgradeSourceRequests(database)

    expect(columnNames(database, 'source_initializations')).toEqual(expect.arrayContaining([
      'rule_version',
      'commit_result_json',
      'matching_config_json',
      'matching_config_fingerprint',
      'matching_data_fingerprint',
    ]))
    expect(columnNames(database, 'source_sync_queue')).toEqual(expect.arrayContaining([
      'request_kind',
      'mode',
      'trigger',
      'initialization_id',
      'follow_up_of',
      'allow_disabled',
      'take_over_external',
    ]))
    expect(database.prepare('SELECT id, source_id, status, created_at, updated_at FROM source_initializations').all()).toEqual(beforeInitialization)
    expect(database.prepare('SELECT id, source_id, schedule_window, status, available_at, created_at, updated_at FROM source_sync_queue').all()).toEqual(beforeRequest)
  })
})
