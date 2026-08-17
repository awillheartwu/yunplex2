import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb, initDb } from '../db'
import { DEFAULT_CONFIG } from '../config/defaults'
import type { NeteaseSong } from '../netease'
import { upsertSongIdentityBinding } from './identity-store'
import {
  getLocalMediaAsset,
  inspectLocalMediaAssets,
  persistLocalMediaInspection,
  upsertLocalMediaAsset,
} from './local-media-store'
import { hasMissingMediaPolicyWork, planMissingMedia } from './missing-media-policy'

const dirs: string[] = []

afterEach(() => {
  closeDb()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'reyunplex-missing-media-'))
  dirs.push(dir)
  initDb(dir)
  const config = structuredClone(DEFAULT_CONFIG)
  config.download.dir = dir
  config.other.pathFormat = '{artist}/{album}/{title}'
  return { dir, config }
}

function song(id: number): NeteaseSong {
  return {
    id,
    name: `Song ${id}`,
    no: 1,
    dt: 1000,
    disc: '1',
    artists: [{ name: 'Artist' }],
    album: { id: 10, name: 'Album', picUrl: '', publishTime: 0 },
  }
}

function writeFlac(filePath: string, suffix = ''): void {
  writeFileSync(filePath, `fLaC${suffix}`)
}

describe('missing media policy', () => {
  it('preserves manual authority even when no media asset exists', () => {
    const { config } = setup()
    upsertSongIdentityBinding({
      neteaseSongId: 1,
      plexSectionKey: '12',
      plexFilePath: '/music/manual.flac',
      plexRatingKey: 'manual-1',
      mbRecordingId: null,
      bindingMethod: 'manual',
      status: 'active',
      evidence: {},
    })

    expect(planMissingMedia([song(1)], config, { validateAudio: true }).get(1)?.disposition)
      .toBe('manual_exempt')
  })

  it('reuses active managed and external assets globally by song id', () => {
    const { dir, config } = setup()
    const managed = join(dir, 'managed.flac')
    const external = join(dir, 'external.flac')
    writeFlac(managed)
    writeFlac(external)
    upsertLocalMediaAsset({ neteaseSongId: 1, filePath: managed, provenance: 'download_task', ownership: 'managed' })
    upsertLocalMediaAsset({ neteaseSongId: 2, filePath: external, provenance: 'computed', ownership: 'external' })

    const plans = planMissingMedia([song(1), song(2), song(1)], config, { validateAudio: true })

    expect(plans.get(1)?.disposition).toBe('reuse_managed')
    expect(plans.get(2)?.disposition).toBe('reuse_external')
    expect(plans.size).toBe(2)
    expect(hasMissingMediaPolicyWork([song(1), song(2)], config)).toBe(false)
  })

  it('downloads when only an automatic binding exists', () => {
    const { config } = setup()
    upsertSongIdentityBinding({
      neteaseSongId: 3,
      plexSectionKey: '12',
      plexFilePath: '/music/automatic.flac',
      plexRatingKey: 'auto-3',
      mbRecordingId: null,
      bindingMethod: 'path',
      status: 'active',
      evidence: {},
    })

    expect(planMissingMedia([song(3)], config, { validateAudio: true }).get(3)?.disposition)
      .toBe('download_missing')
  })

  it('redownloads a managed asset changed outside a managed write', () => {
    const { dir, config } = setup()
    const filePath = join(dir, 'changed.flac')
    writeFlac(filePath)
    upsertLocalMediaAsset({ neteaseSongId: 4, filePath, provenance: 'download_task', ownership: 'managed' })
    writeFlac(filePath, '-replacement')

    expect(planMissingMedia([song(4)], config, { validateAudio: true }).get(4)).toMatchObject({
      disposition: 'redownload_replaced',
      audioPath: filePath,
    })
  })

  it('keeps inspection pure and persists discovered history only when requested', () => {
    const { dir, config } = setup()
    const filePath = join(dir, 'history.flac')
    writeFlac(filePath)
    const now = new Date().toISOString()
    getDb().prepare(`
      INSERT INTO download_tasks (
        id, song_id, song_name, status, file_path, created_at, updated_at
      ) VALUES (?, ?, ?, 'done', ?, ?, ?)
    `).run('history-task', 5, 'Song 5', filePath, now, now)

    const inspected = inspectLocalMediaAssets([song(5)], config).get(5)!
    expect(inspected.state).toBe('unregistered_managed')
    expect(getLocalMediaAsset(5)).toBeNull()

    persistLocalMediaInspection(inspected)
    expect(getLocalMediaAsset(5)).toMatchObject({
      ownership: 'managed',
      provenance: 'legacy_download_task',
      sourceTaskId: 'history-task',
    })
  })
})
