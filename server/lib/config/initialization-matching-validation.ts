import { artistMatchingKey, matchingKey } from '../../../shared/initialization-matching-text'
import type { InitializationMatchingConfig, MatchingAlias } from '../../../shared/initialization-matching'
import { DEFAULT_INITIALIZATION_MATCHING } from '../../../shared/initialization-matching'
import { deepMerge } from './merge'

type PlainRecord = Record<string, unknown>

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigValidationError'
  }
}

export const MATCHING_KEYS = new Set(Object.keys(DEFAULT_INITIALIZATION_MATCHING))

const ALIAS_KEYS = new Set(['name', 'aliases', 'enabled'])
const ARTIST_POLICIES = new Set(['complete', 'primary'])
const ALBUM_POLICIES = new Set(['require', 'prefer', 'ignore'])
const TRACK_POLICIES = new Set(['require', 'prefer', 'ignore'])
const MISSING_DURATION_POLICIES = new Set(['exclude', 'review'])
const REMASTER_POLICIES = new Set(['strict', 'review', 'allow'])
const EDITION_POLICIES = new Set(['strict', 'review'])
const EXPLICIT_POLICIES = new Set(['strict', 'review'])
const UNKNOWN_VERSION_POLICIES = new Set(['exclude', 'review'])

// Keep imported configuration finite even though aliases are only candidate hints.
const MAX_ALIAS_GROUPS = 256
const MAX_ALIASES_PER_GROUP = 64
const MAX_ALIAS_TEXT_LENGTH = 256

export function validateInitializationMatching(input: unknown = {}): InitializationMatchingConfig {
  const patch = input === undefined ? {} : input
  assertMatchingPatchShape(patch)
  const candidate = deepMerge(
    DEFAULT_INITIALIZATION_MATCHING,
    patch as Partial<InitializationMatchingConfig>,
  )

  const config: InitializationMatchingConfig = {
    enabled: readBoolean(candidate.enabled, '初始化匹配.enabled'),
    foldChinese: readBoolean(candidate.foldChinese, '初始化匹配.foldChinese'),
    normalizeTypography: readBoolean(candidate.normalizeTypography, '初始化匹配.normalizeTypography'),
    foldArtistDiacritics: readBoolean(candidate.foldArtistDiacritics, '初始化匹配.foldArtistDiacritics'),
    corroboratedBilingualTitles: readBoolean(candidate.corroboratedBilingualTitles, '初始化匹配.corroboratedBilingualTitles'),
    ignoreContextNotes: readBoolean(candidate.ignoreContextNotes, '初始化匹配.ignoreContextNotes'),
    bilingualTitles: readBoolean(candidate.bilingualTitles, '初始化匹配.bilingualTitles'),
    fuzzyTitles: readBoolean(candidate.fuzzyTitles, '初始化匹配.fuzzyTitles'),
    supplementalTitleRecall: readBoolean(candidate.supplementalTitleRecall, '初始化匹配.supplementalTitleRecall'),
    metadataFallback: readBoolean(candidate.metadataFallback, '初始化匹配.metadataFallback'),
    corroboratedRecommendations: readBoolean(candidate.corroboratedRecommendations, '初始化匹配.corroboratedRecommendations'),
    preferExactAlbum: readBoolean(candidate.preferExactAlbum, '初始化匹配.preferExactAlbum'),
    duplicatePolicy: readEnum(candidate.duplicatePolicy, new Set(['review', 'highest_quality']), '初始化匹配.duplicatePolicy'),
    ignoreMissingCollaborators: readBoolean(candidate.ignoreMissingCollaborators, '初始化匹配.ignoreMissingCollaborators'),
    musicBrainzAliases: readBoolean(candidate.musicBrainzAliases, '初始化匹配.musicBrainzAliases'),
    musicBrainzMinScore: readInteger(candidate.musicBrainzMinScore, '初始化匹配.musicBrainzMinScore', 90, 100),
    musicBrainzMaxArtists: readInteger(candidate.musicBrainzMaxArtists, '初始化匹配.musicBrainzMaxArtists', 1, 200),
    useTrackArtist: readBoolean(candidate.useTrackArtist, '初始化匹配.useTrackArtist'),
    useArtistAliases: readBoolean(candidate.useArtistAliases, '初始化匹配.useArtistAliases'),
    artistPolicy: readEnum(candidate.artistPolicy, ARTIST_POLICIES, '初始化匹配.artistPolicy'),
    usePathHints: readBoolean(candidate.usePathHints, '初始化匹配.usePathHints'),
    albumPolicy: readEnum(candidate.albumPolicy, ALBUM_POLICIES, '初始化匹配.albumPolicy'),
    trackPolicy: readEnum(candidate.trackPolicy, TRACK_POLICIES, '初始化匹配.trackPolicy'),
    recommendDurationMs: readInteger(candidate.recommendDurationMs, '初始化匹配.recommendDurationMs', 0, 30000),
    reviewDurationMs: readInteger(candidate.reviewDurationMs, '初始化匹配.reviewDurationMs', 0, 30000),
    recommendDurationPercent: readNumber(candidate.recommendDurationPercent, '初始化匹配.recommendDurationPercent', 0, 10),
    quickMatchThreshold: readInteger(candidate.quickMatchThreshold, '初始化匹配.quickMatchThreshold', 0, 100),
    missingDuration: readEnum(candidate.missingDuration, MISSING_DURATION_POLICIES, '初始化匹配.missingDuration'),
    remasterPolicy: readEnum(candidate.remasterPolicy, REMASTER_POLICIES, '初始化匹配.remasterPolicy'),
    editionPolicy: readEnum(candidate.editionPolicy, EDITION_POLICIES, '初始化匹配.editionPolicy'),
    explicitPolicy: readEnum(candidate.explicitPolicy, EXPLICIT_POLICIES, '初始化匹配.explicitPolicy'),
    showVersionConflicts: readBoolean(candidate.showVersionConflicts, '初始化匹配.showVersionConflicts'),
    unknownVersion: readEnum(candidate.unknownVersion, UNKNOWN_VERSION_POLICIES, '初始化匹配.unknownVersion'),
    preferLossless: readBoolean(candidate.preferLossless, '初始化匹配.preferLossless'),
    preferredDirectory: readString(candidate.preferredDirectory, '初始化匹配.preferredDirectory'),
    artistAliases: readAliasGroups(candidate.artistAliases, '初始化匹配.artistAliases'),
    titleAliases: readAliasGroups(candidate.titleAliases, '初始化匹配.titleAliases'),
  }

  assertEffectiveAliases(config.artistAliases, config, '艺人')
  assertEffectiveAliases(config.titleAliases, config, '标题')

  if (config.recommendDurationMs > config.reviewDurationMs) {
    throw new ConfigValidationError('初始化匹配.recommendDurationMs不能大于reviewDurationMs')
  }

  return config
}

/**
 * Normalize persisted configs without discarding valid fields from a block that
 * contains one invalid field. Strict writes use validateInitializationMatching.
 */
export function migrateInitializationMatching(input: unknown): InitializationMatchingConfig {
  if (input === undefined) return structuredClone(DEFAULT_INITIALIZATION_MATCHING)

  try {
    return validateInitializationMatching(input)
  } catch {
    const source = isPlainRecord(input) ? input : {}
    const config = structuredClone(DEFAULT_INITIALIZATION_MATCHING)

    for (const key of ['enabled', 'foldChinese', 'normalizeTypography', 'foldArtistDiacritics', 'corroboratedBilingualTitles', 'ignoreContextNotes', 'bilingualTitles', 'fuzzyTitles', 'supplementalTitleRecall', 'metadataFallback', 'corroboratedRecommendations', 'preferExactAlbum', 'ignoreMissingCollaborators', 'musicBrainzAliases', 'useTrackArtist', 'useArtistAliases', 'usePathHints', 'showVersionConflicts', 'preferLossless'] as const) {
      const value = coerceBoolean(source[key])
      if (value !== undefined) config[key] = value
    }

    config.duplicatePolicy = coerceEnum(source.duplicatePolicy, new Set(['review', 'highest_quality']), config.duplicatePolicy)
    config.musicBrainzMinScore = coerceInteger(source.musicBrainzMinScore, config.musicBrainzMinScore, 90, 100)
    config.musicBrainzMaxArtists = coerceInteger(source.musicBrainzMaxArtists, config.musicBrainzMaxArtists, 1, 200)
    config.artistPolicy = coerceEnum(source.artistPolicy, ARTIST_POLICIES, config.artistPolicy)
    config.albumPolicy = coerceEnum(source.albumPolicy, ALBUM_POLICIES, config.albumPolicy)
    config.trackPolicy = coerceEnum(source.trackPolicy, TRACK_POLICIES, config.trackPolicy)
    config.missingDuration = coerceEnum(source.missingDuration, MISSING_DURATION_POLICIES, config.missingDuration)
    config.remasterPolicy = coerceEnum(source.remasterPolicy, REMASTER_POLICIES, config.remasterPolicy)
    config.editionPolicy = coerceEnum(source.editionPolicy, EDITION_POLICIES, config.editionPolicy)
    config.explicitPolicy = coerceEnum(source.explicitPolicy, EXPLICIT_POLICIES, config.explicitPolicy)
    config.unknownVersion = coerceEnum(source.unknownVersion, UNKNOWN_VERSION_POLICIES, config.unknownVersion)

    config.recommendDurationMs = coerceInteger(source.recommendDurationMs, config.recommendDurationMs, 0, 30000)
    config.reviewDurationMs = coerceInteger(source.reviewDurationMs, config.reviewDurationMs, 0, 30000)
    config.recommendDurationPercent = coerceNumber(source.recommendDurationPercent, config.recommendDurationPercent, 0, 10)
    config.quickMatchThreshold = coerceInteger(source.quickMatchThreshold, config.quickMatchThreshold, 0, 100)
    config.preferredDirectory = typeof source.preferredDirectory === 'string'
      ? source.preferredDirectory
      : config.preferredDirectory
    if (config.recommendDurationMs > config.reviewDurationMs) {
      config.recommendDurationMs = config.reviewDurationMs
    }

    config.artistAliases = coerceAliasGroups(source.artistAliases)
    config.titleAliases = coerceAliasGroups(source.titleAliases)
    for (const [groups, label] of [[config.artistAliases, '艺人'], [config.titleAliases, '标题']] as const) {
      groups.forEach((group, index) => {
        try { assertEffectiveAliases(groups.slice(0, index + 1), config, label) }
        catch { group.enabled = false }
      })
    }
    return config
  }
}

export function assertMatchingPatchShape(input: unknown): asserts input is Partial<InitializationMatchingConfig> {
  if (!isPlainRecord(input)) {
    throw new ConfigValidationError('初始化匹配配置必须是对象')
  }
  assertKnownKeys(input, MATCHING_KEYS, '初始化匹配')

  for (const key of ['artistAliases', 'titleAliases'] as const) {
    if (Object.hasOwn(input, key)) assertAliasArrayShape(input[key], `初始化匹配.${key}`)
  }
}

function assertAliasArrayShape(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new ConfigValidationError(`${label}必须是数组`)
  if (value.length > MAX_ALIAS_GROUPS) {
    throw new ConfigValidationError(`${label}最多支持${MAX_ALIAS_GROUPS}组`)
  }
  value.forEach((entry, index) => {
    if (!isPlainRecord(entry)) throw new ConfigValidationError(`${label}[${index}]必须是对象`)
    assertKnownKeys(entry, ALIAS_KEYS, `${label}[${index}]`)
    if (!Object.hasOwn(entry, 'name') || !Object.hasOwn(entry, 'aliases') || !Object.hasOwn(entry, 'enabled')) {
      throw new ConfigValidationError(`${label}[${index}]必须包含name、aliases和enabled`)
    }
    readNonEmptyAliasText(entry.name, `${label}[${index}].name`)
    if (!Array.isArray(entry.aliases)) throw new ConfigValidationError(`${label}[${index}].aliases必须是数组`)
    if (entry.aliases.length > MAX_ALIASES_PER_GROUP) {
      throw new ConfigValidationError(`${label}[${index}].aliases最多支持${MAX_ALIASES_PER_GROUP}项`)
    }
    entry.aliases.forEach((alias, aliasIndex) => {
      readNonEmptyAliasText(alias, `${label}[${index}].aliases[${aliasIndex}]`)
    })
    readBoolean(entry.enabled, `${label}[${index}].enabled`)
  })
}

function readAliasGroups(value: unknown, label: string): MatchingAlias[] {
  assertAliasArrayShape(value, label)
  const groups = (value as unknown[]).map((entry) => {
    const alias = entry as PlainRecord
    return {
      name: readNonEmptyAliasText(alias.name, `${label}.name`),
      aliases: (alias.aliases as unknown[]).map((item, index) => readNonEmptyAliasText(item, `${label}.aliases[${index}]`)),
      enabled: readBoolean(alias.enabled, `${label}.enabled`),
    }
  })
  assertNoOverlappingEnabledGroups(groups, label)
  return groups
}

function assertNoOverlappingEnabledGroups(groups: MatchingAlias[], label: string) {
  const seen = new Map<string, number>()
  groups.forEach((group, groupIndex) => {
    if (!group.enabled) return
    for (const value of [group.name, ...group.aliases]) {
      const key = normalizeAliasKey(value)
      const previousGroup = seen.get(key)
      if (previousGroup !== undefined && previousGroup !== groupIndex) {
        throw new ConfigValidationError(`${label}启用组之间存在重叠：${value}`)
      }
      seen.set(key, groupIndex)
    }
  })
}

function normalizeAliasKey(value: string): string {
  return value.normalize('NFC').toLowerCase().trim()
}

function readNonEmptyAliasText(value: unknown, label: string): string {
  const text = readString(value, label)
  if (!text.trim()) throw new ConfigValidationError(`${label}不能为空`)
  if (text.length > MAX_ALIAS_TEXT_LENGTH) {
    throw new ConfigValidationError(`${label}长度不能超过${MAX_ALIAS_TEXT_LENGTH}个字符`)
  }
  return text
}

function readString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new ConfigValidationError(`${label}必须是字符串`)
  return value
}

function readBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new ConfigValidationError(`${label}必须是布尔值`)
  return value
}

function readNumber(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ConfigValidationError(`${label}必须是有限数字`)
  }
  if (value < min || value > max) throw new ConfigValidationError(`${label}必须在${min}-${max}之间`)
  return value
}

function readInteger(value: unknown, label: string, min: number, max: number): number {
  const numberValue = readNumber(value, label, min, max)
  if (!Number.isInteger(numberValue)) throw new ConfigValidationError(`${label}必须是整数`)
  return numberValue
}

function readEnum<T extends string>(value: unknown, allowed: Set<string>, label: string): T {
  if (typeof value !== 'string' || !allowed.has(value)) {
    throw new ConfigValidationError(`${label}不是有效选项`)
  }
  return value as T
}

function coerceAliasGroups(value: unknown): MatchingAlias[] {
  if (!Array.isArray(value)) return []
  const groups: MatchingAlias[] = []
  for (const entry of value.slice(0, MAX_ALIAS_GROUPS)) {
    if (!isPlainRecord(entry)) continue
    if (typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > MAX_ALIAS_TEXT_LENGTH) continue
    if (!Array.isArray(entry.aliases) || entry.aliases.length > MAX_ALIASES_PER_GROUP) continue
    const aliases = entry.aliases.filter((alias): alias is string =>
      typeof alias === 'string' && Boolean(alias.trim()) && alias.length <= MAX_ALIAS_TEXT_LENGTH),
    enabled = coerceBoolean(entry.enabled)
    if (enabled === undefined || aliases.length !== entry.aliases.length) continue
    const candidate = { name: entry.name, aliases, enabled }
    if (enabled && hasAliasOverlap(groups, candidate)) continue
    groups.push(candidate)
  }
  return groups
}

function hasAliasOverlap(groups: MatchingAlias[], candidate: MatchingAlias): boolean {
  const candidateKeys = new Set([candidate.name, ...candidate.aliases].map(normalizeAliasKey))
  return groups.some((group) => group.enabled && [group.name, ...group.aliases]
    .some((value) => candidateKeys.has(normalizeAliasKey(value))))
}

function coerceBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }
  return undefined
}

function coerceNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : NaN
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function coerceInteger(value: unknown, fallback: number, min: number, max: number): number {
  return Math.round(coerceNumber(value, fallback, min, max))
}

function coerceEnum<T extends string>(value: unknown, allowed: Set<string>, fallback: T): T {
  return typeof value === 'string' && allowed.has(value) ? value as T : fallback
}

function isPlainRecord(value: unknown): value is PlainRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertKnownKeys(value: PlainRecord, allowed: Set<string>, label: string) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new ConfigValidationError(`${label}包含未知配置项：${key}`)
  }
}

function assertEffectiveAliases(groups: MatchingAlias[], config: InitializationMatchingConfig, label: string): void {
  const owners = new Map<string, number>()
  groups.forEach((group, index) => {
    if (!group.enabled) return
    for (const name of [group.name, ...group.aliases]) {
      const key = label === '艺人' ? artistMatchingKey(name, config) : matchingKey(name, config)
      if (!key) throw new ConfigValidationError(`${label}别名归一化后不能为空`)
      if (owners.has(key) && owners.get(key) !== index) throw new ConfigValidationError(`${label}别名在当前文字规则下重叠：${name}`)
      owners.set(key, index)
    }
  })
}
