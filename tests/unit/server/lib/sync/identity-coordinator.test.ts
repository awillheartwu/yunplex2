import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, initDb } from '~~/server/lib/db'
import {
  applyVerifiedBindingsIfSnapshotCurrent,
  captureBindingVersions,
} from '~~/server/lib/sync/identity-coordinator'
import {
  getSongIdentityBinding,
  upsertSongIdentityBinding,
} from '~~/server/lib/sync/identity-store'

const tempDirs: string[] = []

function setup(): void {
  const dir = mkdtempSync(join(tmpdir(), 'reyunplex-identity-coordinator-'))
  tempDirs.push(dir)
  initDb(dir)
}

afterEach(() => {
  closeDb()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function binding(neteaseSongId: number, fileName: string) {
  return {
    neteaseSongId,
    plexSectionKey: '12',
    plexFilePath: `/music/${fileName}.flac`,
    plexRatingKey: `rating-${fileName}`,
    mbRecordingId: null,
    bindingMethod: 'path' as const,
    status: 'active' as const,
    evidence: { source: 'test' },
  }
}

describe('identity mutation coordination', () => {
  it('allows this convergence to create a binding after its unchanged null snapshot', () => {
    setup()
    const snapshot = captureBindingVersions([1])

    const current = applyVerifiedBindingsIfSnapshotCurrent(snapshot, [binding(1, 'new')])

    expect(current.get(1)).toMatchObject({
      plexFilePath: '/music/new.flac',
      plexRatingKey: 'rating-new',
    })
  })

  it('rejects a stale convergence before it overwrites a newer binding', () => {
    setup()
    upsertSongIdentityBinding(binding(1, 'initial'))
    const snapshot = captureBindingVersions([1])
    upsertSongIdentityBinding(binding(1, 'concurrent'))

    expect(() => applyVerifiedBindingsIfSnapshotCurrent(snapshot, [binding(1, 'stale')]))
      .toThrow('身份已变化')
    expect(getSongIdentityBinding(1)?.plexFilePath).toBe('/music/concurrent.flac')
  })
})
