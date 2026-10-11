import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '~~/server/lib/config/defaults'
import type { PlaylistSource } from '~~/server/lib/playlist/types'
import { resolveEffectiveSourceSyncSettings } from '~~/server/lib/sync/effective-settings'

function source(overrides: Partial<PlaylistSource> = {}): PlaylistSource {
  return {
    forceFullCompare: null,
    skipPlexPlaylist: null,
    skipRemoveExtraTracks: null,
    fullCompareAfterSkips: null,
    fullCompareAfterDays: null,
    ...overrides,
  } as PlaylistSource
}

describe('effective source sync settings', () => {
  it('inherits global values when source overrides are null', () => {
    const config = structuredClone(DEFAULT_CONFIG)
    config.sync.forceFullCompare = true
    config.sync.skipRemoveExtraTracks = true

    expect(resolveEffectiveSourceSyncSettings(source(), config)).toMatchObject({
      forceFullCompare: true,
      skipRemoveExtraTracks: true,
      fullCompareAfterSkips: config.sync.fullCompareAfterSkips,
    })
  })

  it('allows a source to explicitly disable a globally enabled option', () => {
    const config = structuredClone(DEFAULT_CONFIG)
    config.sync.forceFullCompare = true
    config.sync.skipRemoveExtraTracks = true

    expect(resolveEffectiveSourceSyncSettings(source({
      forceFullCompare: false,
      skipRemoveExtraTracks: false,
    }), config)).toMatchObject({
      forceFullCompare: false,
      skipRemoveExtraTracks: false,
    })
  })
})
