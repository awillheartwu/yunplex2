import { describe, expect, it } from 'vitest'
import { DEFAULT_INITIALIZATION_MATCHING, matchingPreset } from '../../../shared/initialization-matching'
import { deepMerge, mergeAndValidateConfig, migrateConfig, validateFullConfig, validateInitializationMatching } from './validation'
import { DEFAULT_CONFIG } from './defaults'

describe('initialization matching config', () => {
  it('validates bulk policies and bounded MusicBrainz queries through the full config path', () => {
    const current = structuredClone(DEFAULT_CONFIG)
    const result = mergeAndValidateConfig(current, { initializationMatching: { ignoreMissingCollaborators: true, musicBrainzAliases: true, musicBrainzMaxArtists: 60 } })
    expect(result.initializationMatching).toMatchObject({ duplicatePolicy: 'highest_quality', ignoreMissingCollaborators: true, musicBrainzAliases: true, musicBrainzMaxArtists: 60 })
    for (const patch of [{ duplicatePolicy: 'anything' }, { musicBrainzMaxArtists: 201 }, { musicBrainzMinScore: 89 }, { ignoreMissingCollaborators: 'yes' }]) {
      expect(() => validateInitializationMatching(patch)).toThrow()
    }
    expect(migrateConfig({ ...current, initializationMatching: { musicBrainzAliases: 'true', musicBrainzMaxArtists: 999 } }).config.initializationMatching)
      .toMatchObject({ musicBrainzAliases: true, musicBrainzMaxArtists: 200 })
  })
  it('defaults and validates the exact-album preference independently', () => {
    expect(validateInitializationMatching({}).preferExactAlbum).toBe(true)
    expect(validateInitializationMatching({ preferExactAlbum: false }).preferExactAlbum).toBe(false)
    expect(() => validateInitializationMatching({ preferExactAlbum: 'yes' })).toThrow()
    expect(migrateConfig({ ...DEFAULT_CONFIG, initializationMatching: {} }).config.initializationMatching?.preferExactAlbum).toBe(true)
  })

  it('validates dependent partial settings against the merged current config', () => {
    const current = structuredClone(DEFAULT_CONFIG)
    current.initializationMatching!.reviewDurationMs = 12000
    expect(mergeAndValidateConfig(current, { initializationMatching: { recommendDurationMs: 8000 } }).initializationMatching!.recommendDurationMs).toBe(8000)
    expect(() => mergeAndValidateConfig(current, { initializationMatching: { recommendDurationMs: 13000 } })).toThrow('不能大于')
  })

  it('normalizes a partial preview config against the shared defaults', () => {
    const config = validateInitializationMatching({
      enabled: true,
      reviewDurationMs: 12000,
      artistAliases: [{ name: '周杰伦', aliases: ['Jay'], enabled: true }],
    })

    expect(config).toMatchObject({
      ...DEFAULT_INITIALIZATION_MATCHING,
      enabled: true,
      reviewDurationMs: 12000,
      artistAliases: [{ name: '周杰伦', aliases: ['Jay'], enabled: true }],
    })
  })

  it('rejects unknown nested fields and invalid scalar values', () => {
    expect(() => validateInitializationMatching({ unknown: true })).toThrow('初始化匹配包含未知配置项：unknown')
    expect(() => validateInitializationMatching({ artistAliases: [{ name: 'A', aliases: [], enabled: true, extra: 1 }] })).toThrow('包含未知配置项：extra')
    expect(() => validateInitializationMatching({ enabled: 'true' })).toThrow('enabled必须是布尔值')
    expect(() => validateInitializationMatching({ supplementalTitleRecall: 'true' })).toThrow('supplementalTitleRecall必须是布尔值')
    expect(() => validateInitializationMatching({ metadataFallback: 1 })).toThrow('metadataFallback必须是布尔值')
    expect(() => validateInitializationMatching({ corroboratedRecommendations: 'true' })).toThrow('corroboratedRecommendations必须是布尔值')
    expect(() => validateInitializationMatching({ artistPolicy: 'all' })).toThrow('artistPolicy不是有效选项')
    expect(() => validateInitializationMatching({ recommendDurationMs: 30001 })).toThrow('recommendDurationMs必须在0-30000之间')
    expect(() => validateInitializationMatching({ reviewDurationMs: 1.5 })).toThrow('reviewDurationMs必须是整数')
    expect(() => validateInitializationMatching({ recommendDurationPercent: Number.NaN })).toThrow('recommendDurationPercent必须是有限数字')
    expect(() => validateInitializationMatching({ recommendDurationMs: 2000, reviewDurationMs: 1000 })).toThrow('不能大于reviewDurationMs')
  })

  it('validates alias groups and detects normalized overlap among enabled groups', () => {
    expect(() => validateInitializationMatching({
      titleAliases: [
        { name: 'Cafe\u0301', aliases: [], enabled: true },
        { name: 'CAFÉ', aliases: [], enabled: true },
      ],
    })).toThrow('启用组之间存在重叠')

    expect(() => validateInitializationMatching({
      titleAliases: [{ name: '   ', aliases: ['x'], enabled: true }],
    })).toThrow('name不能为空')

    expect(() => validateInitializationMatching({
      titleAliases: [{ name: 'A', aliases: [''], enabled: true }],
    })).toThrow('aliases[0]不能为空')

    expect(validateInitializationMatching({
      titleAliases: [
        { name: 'A', aliases: ['B'], enabled: false },
        { name: 'b', aliases: [], enabled: true },
      ],
    }).titleAliases).toHaveLength(2)
  })

  it('rejects aliases that collide under the configured Chinese and punctuation rules', () => {
    const artistAliases = [
      { name: '张悬', aliases: ['Deserts'], enabled: true },
      { name: '張懸', aliases: ['Other Artist'], enabled: true },
    ]
    expect(() => validateInitializationMatching({ artistAliases })).toThrow('当前文字规则下重叠')
    expect(validateInitializationMatching({ artistAliases, foldChinese: false }).artistAliases).toHaveLength(2)
    const migrated = migrateConfig({ ...DEFAULT_CONFIG, initializationMatching: { artistAliases } }).config.initializationMatching!
    expect(migrated.artistAliases.map(group => group.enabled)).toEqual([true, false])
  })

  it('bounds alias group, alias and text sizes', () => {
    expect(() => validateInitializationMatching({
      artistAliases: Array.from({ length: 257 }, (_, index) => ({ name: `artist-${index}`, aliases: [], enabled: false })),
    })).toThrow('最多支持256组')
    expect(() => validateInitializationMatching({
      artistAliases: [{ name: 'artist', aliases: Array.from({ length: 65 }, (_, index) => `alias-${index}`), enabled: true }],
    })).toThrow('最多支持64项')
    expect(() => validateInitializationMatching({
      artistAliases: [{ name: 'a'.repeat(257), aliases: [], enabled: true }],
    })).toThrow('长度不能超过256个字符')
  })

  it('replaces alias arrays during config patches', () => {
    const current = structuredClone(DEFAULT_CONFIG)
    current.initializationMatching!.artistAliases = [{ name: '旧', aliases: ['old'], enabled: true }]

    const merged = deepMerge(current, {
      initializationMatching: {
        artistAliases: [{ name: '新', aliases: ['new'], enabled: true }],
      },
    })

    expect(merged.initializationMatching?.artistAliases).toEqual([
      { name: '新', aliases: ['new'], enabled: true },
    ])
  })

  it('adds defaults when migrating legacy configs and retains valid new settings', () => {
    const legacy = structuredClone(DEFAULT_CONFIG) as Record<string, unknown>
    delete legacy.initializationMatching
    const migratedLegacy = migrateConfig(legacy)
    expect(migratedLegacy.config.initializationMatching).toEqual(DEFAULT_INITIALIZATION_MATCHING)

    const persisted = structuredClone(DEFAULT_CONFIG) as Record<string, any>
    persisted.initializationMatching = {
      enabled: true,
      artistPolicy: 'primary',
      reviewDurationMs: 9000,
      preferredDirectory: '/music',
    }
    const migrated = migrateConfig(persisted)
    expect(migrated.config.initializationMatching).toMatchObject({
      enabled: true,
      artistPolicy: 'primary',
      reviewDurationMs: 9000,
      preferredDirectory: '/music',
      fuzzyTitles: DEFAULT_INITIALIZATION_MATCHING.fuzzyTitles,
      supplementalTitleRecall: DEFAULT_INITIALIZATION_MATCHING.supplementalTitleRecall,
      metadataFallback: DEFAULT_INITIALIZATION_MATCHING.metadataFallback,
    })
  })

  it('uses the new retrieval defaults when persisted fields are missing', () => {
    const persisted = structuredClone(DEFAULT_CONFIG) as Record<string, any>
    persisted.initializationMatching = { enabled: true }

    expect(migrateConfig(persisted).config.initializationMatching).toMatchObject({
      supplementalTitleRecall: true,
      metadataFallback: true,
    })
    expect(validateInitializationMatching({}).supplementalTitleRecall).toBe(true)
    expect(validateInitializationMatching({}).metadataFallback).toBe(true)
    expect(validateInitializationMatching({}).corroboratedRecommendations).toBe(true)
  })

  it('uses the configured corroboration policy in presets and migration', () => {
    expect(migrateConfig({ ...DEFAULT_CONFIG, initializationMatching: { enabled: true } }).config.initializationMatching?.corroboratedRecommendations).toBe(true)
    expect(migrateConfig({ ...DEFAULT_CONFIG, initializationMatching: { corroboratedRecommendations: 'false' } }).config.initializationMatching?.corroboratedRecommendations).toBe(false)
    expect(matchingPreset('conservative').corroboratedRecommendations).toBe(false)
    expect(matchingPreset('balanced').corroboratedRecommendations).toBe(true)
    expect(matchingPreset('discovery').corroboratedRecommendations).toBe(true)
  })

  it('keeps valid fields when an old saved matching block contains an invalid policy', () => {
    const persisted = structuredClone(DEFAULT_CONFIG) as Record<string, any>
    persisted.initializationMatching = {
      enabled: true,
      albumPolicy: 'invalid',
      trackPolicy: 'require',
      recommendDurationMs: 7000,
      reviewDurationMs: 5000,
    }

    const migrated = migrateConfig(persisted).config.initializationMatching!
    expect(migrated.enabled).toBe(true)
    expect(migrated.albumPolicy).toBe(DEFAULT_INITIALIZATION_MATCHING.albumPolicy)
    expect(migrated.trackPolicy).toBe('require')
    expect(migrated.recommendDurationMs).toBe(5000)
    expect(migrated.reviewDurationMs).toBe(5000)
  })

  it('normalizes legacy full configs without requiring the new top-level section', () => {
    const legacy = structuredClone(DEFAULT_CONFIG) as Record<string, unknown>
    delete legacy.initializationMatching
    expect(validateFullConfig(legacy).initializationMatching).toEqual(DEFAULT_INITIALIZATION_MATCHING)
  })
})
