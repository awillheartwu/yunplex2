import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, initDb } from '~~/server/lib/db'
import { BindingVersionConflictError, getSongIdentityBinding, getSongIdentityBindingByRatingKey, markAutomaticSongIdentityBindingsStale, rebindSongIdentity, unbindSongIdentityWithMode, upsertSongIdentityBinding, upsertVerifiedSongIdentityBinding } from '~~/server/lib/sync/identity-store'

const dirs: string[] = []
function setup() { const dir = mkdtempSync(join(tmpdir(), 'reyunplex-identity-')); dirs.push(dir); initDb(dir) }
afterEach(() => { closeDb(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('media identity store', () => {
  it('stores managed-path and explicit-adoption bindings', () => {
    setup()
    const managed = upsertSongIdentityBinding({ neteaseSongId: 1, plexSectionKey: '12', plexSectionRoot: '/music', plexFilePath: '/music/a.flac', plexRatingKey: 'a', bindingMethod: 'path', status: 'active', evidence: {} })
    const adopted = rebindSongIdentity({ neteaseSongId: 2, expectedBindingUpdatedAt: null, binding: { plexSectionKey: '12', plexSectionRoot: '/music', plexFilePath: '/music/b.flac', plexRatingKey: 'b', evidence: {} } }).binding
    expect(managed).toMatchObject({ bindingMethod: 'path', plexRelativePath: 'a.flac' })
    expect(adopted).toMatchObject({ bindingMethod: 'manual', plexRelativePath: 'b.flac' })
    expect(getSongIdentityBindingByRatingKey('b')?.neteaseSongId).toBe(2)
  })

  it('refreshes a verified path without changing its durable version', () => {
    setup()
    const original = upsertVerifiedSongIdentityBinding({ neteaseSongId: 1, plexSectionKey: '12', plexFilePath: '/music/a.flac', plexRatingKey: 'old', bindingMethod: 'path', status: 'active', evidence: {} })
    const verified = upsertVerifiedSongIdentityBinding({ neteaseSongId: 1, plexSectionKey: '12', plexFilePath: '/music/a.flac', plexRatingKey: 'new', bindingMethod: 'path', status: 'active', evidence: { verified: true } })
    expect(verified.updatedAt).toBe(original.updatedAt)
    expect(verified.plexRatingKey).toBe('new')
  })

  it('preserves a canonical relative path when a verifier omits the section root', () => {
    setup()
    upsertVerifiedSongIdentityBinding({
      neteaseSongId: 1,
      plexSectionKey: '12',
      plexSectionRoot: '/volume1/music',
      plexFilePath: '/volume1/music/Artist/Song.flac',
      plexRatingKey: 'old',
      bindingMethod: 'manual',
      status: 'active',
      evidence: {},
    })

    const verified = upsertVerifiedSongIdentityBinding({
      neteaseSongId: 1,
      plexSectionKey: '12',
      plexFilePath: '/volume1/music/Artist/Song.flac',
      plexRatingKey: 'new',
      bindingMethod: 'manual',
      status: 'active',
      evidence: { verified: true },
    })

    expect(verified.plexRelativePath).toBe('Artist/Song.flac')
  })

  it('rebuild invalidates automatic links but preserves explicit adoption', () => {
    setup()
    upsertSongIdentityBinding({ neteaseSongId: 1, plexSectionKey: '12', plexFilePath: '/music/a.flac', plexRatingKey: 'a', bindingMethod: 'path', status: 'active', evidence: {} })
    upsertSongIdentityBinding({ neteaseSongId: 2, plexSectionKey: '12', plexFilePath: '/music/b.flac', plexRatingKey: 'b', bindingMethod: 'manual', status: 'active', evidence: {} })
    expect(markAutomaticSongIdentityBindingsStale([1, 2])).toBe(1)
    expect(getSongIdentityBinding(1)?.status).toBe('stale')
    expect(getSongIdentityBinding(2)?.status).toBe('active')
  })

  it('uses optimistic version checks when cancelling adoption', () => {
    setup()
    const binding = upsertSongIdentityBinding({ neteaseSongId: 2, plexSectionKey: '12', plexFilePath: '/music/b.flac', plexRatingKey: 'b', bindingMethod: 'manual', status: 'active', evidence: {} })
    expect(() => unbindSongIdentityWithMode({ neteaseSongId: 2, expectedBindingUpdatedAt: 'stale', mode: 'reevaluate' })).toThrow(BindingVersionConflictError)
    expect(unbindSongIdentityWithMode({ neteaseSongId: 2, expectedBindingUpdatedAt: binding.updatedAt, mode: 'reevaluate' }).binding.status).toBe('unbound')
  })

  it('rejects adopting one Plex media identity for two different NetEase songs', () => {
    setup()
    rebindSongIdentity({
      neteaseSongId: 1,
      expectedBindingUpdatedAt: null,
      binding: {
        plexSectionKey: '12',
        plexSectionRoot: '/music',
        plexFilePath: '/music/shared.flac',
        plexRatingKey: 'shared',
        evidence: {},
      },
    })

    expect(() => rebindSongIdentity({
      neteaseSongId: 2,
      expectedBindingUpdatedAt: null,
      binding: {
        plexSectionKey: '12',
        plexSectionRoot: '/music',
        plexFilePath: '/music/shared.flac',
        plexRatingKey: 'shared',
        evidence: {},
      },
    })).toThrow('该 Plex 媒体已关联到另一首网易云歌曲')
    expect(getSongIdentityBinding(2)).toBeNull()
  })
})
