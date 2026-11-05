import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, initDb } from '~~/server/lib/db'
import { captureSourceConvergenceCheckpoint } from '~~/server/lib/sync/source-checkpoint'
import {
  applyVerifiedBindingsIfSnapshotCurrent,
  assertBindingVersionsUnchanged,
  captureBindingVersions,
} from '~~/server/lib/sync/identity-coordinator'
import {
  getSongIdentityBinding,
  upsertSongIdentityBinding,
  unbindSongIdentityWithMode,
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

    const current = applyVerifiedBindingsIfSnapshotCurrent(snapshot, [binding(1, 'new')], new Map([[1, null]]))

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

    expect(() => applyVerifiedBindingsIfSnapshotCurrent(snapshot, [binding(1, 'stale')], new Map([[1, 'rating-initial']])))
      .toThrow('身份已变化')
    expect(getSongIdentityBinding(1)?.plexFilePath).toBe('/music/concurrent.flac')
  })

  it('keeps a previously deferred choice out of automatic adoption without blocking other songs', () => {
    setup()
    const original = upsertSongIdentityBinding(binding(1, 'manual'))
    unbindSongIdentityWithMode({ neteaseSongId: 1, expectedBindingUpdatedAt: original.updatedAt, mode: 'exclude_current' })
    const snapshot = captureBindingVersions([1, 2])

    const current = applyVerifiedBindingsIfSnapshotCurrent(snapshot, [binding(2, 'new')], captureSourceConvergenceCheckpoint([1, 2]).plexRatingKeys)

    expect(current.has(1)).toBe(false)
    expect(getSongIdentityBinding(1)?.status).toBe('unbound')
    expect(current.get(2)?.plexFilePath).toBe('/music/new.flac')
  })

  it('stops a stale choice but permits the next convergence to use a fresh snapshot', () => {
    setup()
    const original = upsertSongIdentityBinding(binding(1, 'manual'))
    const stale = captureBindingVersions([1, 2])
    unbindSongIdentityWithMode({ neteaseSongId: 1, expectedBindingUpdatedAt: original.updatedAt, mode: 'exclude_current' })

    expect(() => assertBindingVersionsUnchanged(stale)).toThrow('身份已变化')
    expect(getSongIdentityBinding(2)).toBeNull()
    const fresh = captureBindingVersions([1, 2])
    expect(() => applyVerifiedBindingsIfSnapshotCurrent(fresh, [binding(2, 'new')], captureSourceConvergenceCheckpoint([1, 2]).plexRatingKeys)).not.toThrow()
  })
})
