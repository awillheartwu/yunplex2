import { describe, expect, it } from 'vitest'
import type { SongIdentityBinding } from '~~/types/match-review'
import type { LocalMediaAsset } from './local-media-store'
import { decideRedownload } from './redownload-policy'

function asset(overrides: Partial<LocalMediaAsset> = {}): LocalMediaAsset {
  return {
    neteaseSongId: 1,
    filePath: '/music/song.flac',
    provenance: 'download_task',
    ownership: 'managed',
    sourceTaskId: 'task',
    status: 'active',
    fileSize: 10,
    fileMtimeMs: 1,
    evidence: {},
    createdAt: '',
    updatedAt: '',
    lastVerifiedAt: '',
    ...overrides,
  }
}

function binding(method: SongIdentityBinding['bindingMethod']): SongIdentityBinding {
  return {
    neteaseSongId: 1,
    plexSectionKey: '1',
    plexFilePath: '/music/song.flac',
    plexRelativePath: 'song.flac',
    plexRatingKey: '10',
    mbRecordingId: null,
    bindingMethod: method,
    status: 'active',
    evidence: {},
    createdAt: '',
    updatedAt: '',
    lastVerifiedAt: '',
  }
}

describe('forced redownload policy', () => {
  it('replaces managed media and recovers missing media', () => {
    expect(decideRedownload({ asset: asset(), binding: null, takeOverExternal: false }))
      .toEqual({ disposition: 'replace_managed', eligible: true, audioPath: '/music/song.flac' })
    expect(decideRedownload({
      asset: asset({ status: 'missing' }),
      binding: null,
      takeOverExternal: false,
    })).toEqual({ disposition: 'download_missing', eligible: true })
  })

  it('protects external files unless takeover is explicit', () => {
    const external = asset({ ownership: 'external', provenance: 'computed' })
    expect(decideRedownload({ asset: external, binding: null, takeOverExternal: false }).disposition)
      .toBe('skip_external')
    expect(decideRedownload({ asset: external, binding: null, takeOverExternal: true }))
      .toEqual({ disposition: 'replace_external', eligible: true, audioPath: '/music/song.flac' })
  })

  it('never overrides a manual identity binding', () => {
    expect(decideRedownload({ asset: asset(), binding: binding('manual'), takeOverExternal: true }))
      .toEqual({ disposition: 'skip_manual_binding', eligible: false })
  })
})
