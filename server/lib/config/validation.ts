import type { AppConfig, AudioQuality, ExtraTrackRemovalPolicy, LyricOrder, MultiArtistFormat, UnverifiedMediaPolicy } from './types'
import { DEFAULT_CONFIG } from './defaults'
import { deepMerge } from './merge'

export { deepMerge } from './merge'

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigValidationError'
  }
}

type PlainRecord = Record<string, unknown>

const AUDIO_QUALITIES = new Set<AudioQuality>([
  'standard',
  'higher',
  'exhigh',
  'lossless',
  'hires',
  'jyeffect',
  'jymaster',
])

const MULTI_ARTIST_FORMATS = new Set<MultiArtistFormat>([
  'feat',
  'ft',
  'featuring',
  'ampersand',
  'slash',
  'comma',
  'with',
  'and',
  'plus',
])

const LYRIC_ORDERS = new Set<LyricOrder>([
  'original_first',
  'translated_first',
  'separate',
])

const EXTRA_TRACK_REMOVAL_POLICIES = new Set<ExtraTrackRemovalPolicy>([
  'strict',
  'balanced',
  'exact',
])

const UNVERIFIED_MEDIA_POLICIES = new Set<UnverifiedMediaPolicy>([
  'download_managed',
  'wait_manual',
])

const TOP_LEVEL_KEYS = new Set(['netease', 'plex', 'download', 'sync', 'other'])

const SECTION_KEYS: Record<keyof AppConfig, Set<string>> = {
  netease: new Set(['cookie', 'quality']),
  plex: new Set(['server', 'port', 'token', 'section']),
  download: new Set([
    'dir',
    'plexLibraryPathPrefix',
    'downloadLyrics',
    'embedMetadata',
    'embedCover',
    'saveAlbumCover',
    'saveArtistImage',
  ]),
  sync: new Set([
    'intervalMinutes',
    'songLimit',
    'downloadConcurrency',
    'plexScanRetries',
    'plexScanRetryDelaySec',
    'enabled',
    'logRetentionDays',
    'jobRetentionSuccessDays',
    'jobRetentionFailedDays',
    'downloadTaskRetentionDays',
    'forceFullCompare',
    'reconcileOnPlexDrift',
    'fullCompareAfterSkips',
    'fullCompareAfterDays',
    'autoDownloadAlbum',
    'skipPlexPlaylist',
    'skipRemoveExtraTracks',
    'extraTrackRemovalPolicy',
    'maxFailureAttempts',
    'unverifiedMediaPolicy',
  ]),
  other: new Set([
    'multiArtistFormat',
    'lyricOrder',
    'downloadTranslatedLyric',
    'downloadRomajiLyric',
    'artistAliases',
    'applyAliasToAlbum',
    'pathFormat',
    'fontScale',
  ]),
}

const PATH_FILE_VARIABLE_RE = /\{title\}|\{track(?::\d+d)?\}/

export function cloneConfig(config: AppConfig = DEFAULT_CONFIG): AppConfig {
  return structuredClone(config)
}

export function isPlainRecord(value: unknown): value is PlainRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function mergeAndValidateConfig(current: AppConfig, patch: unknown): AppConfig {
  assertConfigPatchShape(patch)
  const merged = deepMerge(current, patch as Partial<AppConfig>)
  return validateFullConfig(merged)
}

export function validateFullConfig(input: unknown): AppConfig {
  assertFullConfigShape(input)
  const candidate = input as AppConfig

  return {
    netease: {
      cookie: readString(candidate.netease.cookie, '网易云 Cookie'),
      quality: readEnum(candidate.netease.quality, AUDIO_QUALITIES, '音质偏好'),
    },
    plex: {
      server: readString(candidate.plex.server, 'Plex 服务器地址'),
      port: readInteger(candidate.plex.port, 'Plex 端口', 1, 65535),
      token: readString(candidate.plex.token, 'Plex Token'),
      section: readString(candidate.plex.section, 'Plex 音乐库名称'),
    },
    download: {
      dir: readRequiredString(candidate.download.dir, '下载目录'),
      plexLibraryPathPrefix: trimTrailingSlashes(readString(candidate.download.plexLibraryPathPrefix, 'Plex 音乐库路径前缀').trim()),
      downloadLyrics: readBoolean(candidate.download.downloadLyrics, '下载歌词'),
      embedMetadata: readBoolean(candidate.download.embedMetadata, '写入元数据标签'),
      embedCover: readBoolean(candidate.download.embedCover, '嵌入封面图'),
      saveAlbumCover: readBoolean(candidate.download.saveAlbumCover, '保存专辑封面'),
      saveArtistImage: readBoolean(candidate.download.saveArtistImage, '保存歌手图片'),
    },
    sync: {
      intervalMinutes: readInteger(candidate.sync.intervalMinutes, '同步间隔', 1, 1440),
      songLimit: readInteger(candidate.sync.songLimit, '歌曲数量上限', 0, 10000),
      downloadConcurrency: readInteger(candidate.sync.downloadConcurrency, '下载并发数', 1, 10),
      plexScanRetries: readInteger(candidate.sync.plexScanRetries, 'Plex 扫描重试次数', 1, 20),
      plexScanRetryDelaySec: readInteger(candidate.sync.plexScanRetryDelaySec, 'Plex 扫描重试间隔', 5, 60),
      enabled: readBoolean(candidate.sync.enabled, '启用自动同步'),
      logRetentionDays: readInteger(candidate.sync.logRetentionDays, '日志保留天数', 1, 30),
      jobRetentionSuccessDays: readInteger(candidate.sync.jobRetentionSuccessDays, '成功运行保留天数', 1, 7),
      jobRetentionFailedDays: readInteger(candidate.sync.jobRetentionFailedDays, '失败运行保留天数', 14, 30),
      downloadTaskRetentionDays: readInteger(candidate.sync.downloadTaskRetentionDays, '下载队列保留天数', 1, 30),
      forceFullCompare: readBoolean(candidate.sync.forceFullCompare, '始终全量对比'),
      reconcileOnPlexDrift: readBoolean(candidate.sync.reconcileOnPlexDrift, 'Plex 漂移自动修复'),
      fullCompareAfterSkips: readInteger(candidate.sync.fullCompareAfterSkips, '连续跳过上限', 0, 100),
      fullCompareAfterDays: readInteger(candidate.sync.fullCompareAfterDays, '全量对比间隔', 0, 365),
      autoDownloadAlbum: readBoolean(candidate.sync.autoDownloadAlbum, '添加专辑后自动下载'),
      skipPlexPlaylist: readBoolean(candidate.sync.skipPlexPlaylist, '默认不入 Plex 歌单'),
      skipRemoveExtraTracks: readBoolean(candidate.sync.skipRemoveExtraTracks, '不删除 Plex 多余歌曲'),
      extraTrackRemovalPolicy: readEnum(candidate.sync.extraTrackRemovalPolicy, EXTRA_TRACK_REMOVAL_POLICIES, '多余歌曲清理策略'),
      maxFailureAttempts: readInteger(candidate.sync.maxFailureAttempts, '连续失败阈值', 1, 20),
      unverifiedMediaPolicy: readEnum(candidate.sync.unverifiedMediaPolicy, UNVERIFIED_MEDIA_POLICIES, '未验证媒体处理方式'),
    },
    other: {
      multiArtistFormat: readEnum(candidate.other.multiArtistFormat, MULTI_ARTIST_FORMATS, '多歌手格式'),
      lyricOrder: readEnum(candidate.other.lyricOrder, LYRIC_ORDERS, '双语歌词存储方式'),
      downloadTranslatedLyric: readBoolean(candidate.other.downloadTranslatedLyric, '下载翻译歌词'),
      downloadRomajiLyric: readBoolean(candidate.other.downloadRomajiLyric, '下载罗马音歌词'),
      artistAliases: readArtistAliases(candidate.other.artistAliases),
      applyAliasToAlbum: readBoolean(candidate.other.applyAliasToAlbum, '别名替换应用到专辑艺人'),
      pathFormat: readPathFormat(candidate.other.pathFormat),
      fontScale: readNumber(candidate.other.fontScale, '字体缩放', 0.8, 1.5),
    },
  }
}

export function migrateConfig(input: unknown): { config: AppConfig; changed: boolean } {
  const source = isPlainRecord(input) ? input : {}
  const config: AppConfig = {
    netease: {
      cookie: coerceString(get(source, 'netease', 'cookie'), DEFAULT_CONFIG.netease.cookie),
      quality: coerceEnum(get(source, 'netease', 'quality'), AUDIO_QUALITIES, DEFAULT_CONFIG.netease.quality),
    },
    plex: {
      server: coerceString(get(source, 'plex', 'server'), DEFAULT_CONFIG.plex.server),
      port: coerceInteger(get(source, 'plex', 'port'), DEFAULT_CONFIG.plex.port, 1, 65535),
      token: coerceString(get(source, 'plex', 'token'), DEFAULT_CONFIG.plex.token),
      section: coerceString(get(source, 'plex', 'section'), DEFAULT_CONFIG.plex.section),
    },
    download: {
      dir: coerceRequiredString(get(source, 'download', 'dir'), DEFAULT_CONFIG.download.dir),
      plexLibraryPathPrefix: trimTrailingSlashes(coerceString(get(source, 'download', 'plexLibraryPathPrefix'), DEFAULT_CONFIG.download.plexLibraryPathPrefix).trim()),
      downloadLyrics: coerceBoolean(get(source, 'download', 'downloadLyrics'), DEFAULT_CONFIG.download.downloadLyrics),
      embedMetadata: coerceBoolean(get(source, 'download', 'embedMetadata'), DEFAULT_CONFIG.download.embedMetadata),
      embedCover: coerceBoolean(get(source, 'download', 'embedCover'), DEFAULT_CONFIG.download.embedCover),
      saveAlbumCover: coerceBoolean(get(source, 'download', 'saveAlbumCover'), DEFAULT_CONFIG.download.saveAlbumCover),
      saveArtistImage: coerceBoolean(get(source, 'download', 'saveArtistImage'), DEFAULT_CONFIG.download.saveArtistImage),
    },
    sync: {
      intervalMinutes: coerceInteger(get(source, 'sync', 'intervalMinutes'), DEFAULT_CONFIG.sync.intervalMinutes, 1, 1440),
      songLimit: coerceInteger(get(source, 'sync', 'songLimit'), DEFAULT_CONFIG.sync.songLimit, 0, 10000),
      downloadConcurrency: coerceInteger(get(source, 'sync', 'downloadConcurrency'), DEFAULT_CONFIG.sync.downloadConcurrency, 1, 10),
      plexScanRetries: coerceInteger(get(source, 'sync', 'plexScanRetries'), DEFAULT_CONFIG.sync.plexScanRetries, 1, 20),
      plexScanRetryDelaySec: coerceInteger(get(source, 'sync', 'plexScanRetryDelaySec'), DEFAULT_CONFIG.sync.plexScanRetryDelaySec, 5, 60),
      enabled: coerceBoolean(get(source, 'sync', 'enabled'), DEFAULT_CONFIG.sync.enabled),
      logRetentionDays: coerceInteger(get(source, 'sync', 'logRetentionDays'), DEFAULT_CONFIG.sync.logRetentionDays, 1, 30),
      jobRetentionSuccessDays: coerceInteger(get(source, 'sync', 'jobRetentionSuccessDays'), DEFAULT_CONFIG.sync.jobRetentionSuccessDays, 1, 7),
      jobRetentionFailedDays: coerceInteger(get(source, 'sync', 'jobRetentionFailedDays'), DEFAULT_CONFIG.sync.jobRetentionFailedDays, 14, 30),
      downloadTaskRetentionDays: coerceInteger(get(source, 'sync', 'downloadTaskRetentionDays'), DEFAULT_CONFIG.sync.downloadTaskRetentionDays, 1, 30),
      forceFullCompare: coerceBoolean(get(source, 'sync', 'forceFullCompare'), DEFAULT_CONFIG.sync.forceFullCompare),
      reconcileOnPlexDrift: coerceBoolean(get(source, 'sync', 'reconcileOnPlexDrift'), DEFAULT_CONFIG.sync.reconcileOnPlexDrift),
      fullCompareAfterSkips: coerceInteger(get(source, 'sync', 'fullCompareAfterSkips'), DEFAULT_CONFIG.sync.fullCompareAfterSkips, 0, 100),
      fullCompareAfterDays: coerceInteger(get(source, 'sync', 'fullCompareAfterDays'), DEFAULT_CONFIG.sync.fullCompareAfterDays, 0, 365),
      autoDownloadAlbum: coerceBoolean(get(source, 'sync', 'autoDownloadAlbum'), DEFAULT_CONFIG.sync.autoDownloadAlbum),
      skipPlexPlaylist: coerceBoolean(get(source, 'sync', 'skipPlexPlaylist'), DEFAULT_CONFIG.sync.skipPlexPlaylist),
      skipRemoveExtraTracks: coerceBoolean(get(source, 'sync', 'skipRemoveExtraTracks'), DEFAULT_CONFIG.sync.skipRemoveExtraTracks),
      extraTrackRemovalPolicy: coerceEnum(
        get(source, 'sync', 'extraTrackRemovalPolicy'),
        EXTRA_TRACK_REMOVAL_POLICIES,
        DEFAULT_CONFIG.sync.extraTrackRemovalPolicy,
      ),
      maxFailureAttempts: coerceInteger(get(source, 'sync', 'maxFailureAttempts'), DEFAULT_CONFIG.sync.maxFailureAttempts, 1, 20),
      unverifiedMediaPolicy: coerceEnum(
        get(source, 'sync', 'unverifiedMediaPolicy'),
        UNVERIFIED_MEDIA_POLICIES,
        DEFAULT_CONFIG.sync.unverifiedMediaPolicy,
      ),
    },
    other: {
      multiArtistFormat: coerceEnum(get(source, 'other', 'multiArtistFormat'), MULTI_ARTIST_FORMATS, DEFAULT_CONFIG.other.multiArtistFormat),
      lyricOrder: coerceEnum(get(source, 'other', 'lyricOrder'), LYRIC_ORDERS, DEFAULT_CONFIG.other.lyricOrder),
      downloadTranslatedLyric: coerceBoolean(get(source, 'other', 'downloadTranslatedLyric'), DEFAULT_CONFIG.other.downloadTranslatedLyric),
      downloadRomajiLyric: coerceBoolean(get(source, 'other', 'downloadRomajiLyric'), DEFAULT_CONFIG.other.downloadRomajiLyric),
      artistAliases: coerceArtistAliases(get(source, 'other', 'artistAliases')),
      applyAliasToAlbum: coerceBoolean(get(source, 'other', 'applyAliasToAlbum'), DEFAULT_CONFIG.other.applyAliasToAlbum),
      pathFormat: coercePathFormat(get(source, 'other', 'pathFormat'), DEFAULT_CONFIG.other.pathFormat),
      fontScale: coerceNumber(get(source, 'other', 'fontScale'), DEFAULT_CONFIG.other.fontScale, 0.8, 1.5),
    },
  }

  return {
    config,
    changed: JSON.stringify(input) !== JSON.stringify(config),
  }
}

function assertConfigPatchShape(input: unknown): asserts input is Partial<AppConfig> {
  if (!isPlainRecord(input)) {
    throw new ConfigValidationError('请求体格式错误')
  }
  assertKnownKeys(input, TOP_LEVEL_KEYS, '配置')

  for (const [section, value] of Object.entries(input)) {
    if (!isPlainRecord(value)) {
      throw new ConfigValidationError(`${sectionLabel(section)} 必须是对象`)
    }
    assertKnownKeys(value, SECTION_KEYS[section as keyof AppConfig], sectionLabel(section))

    if (section === 'other' && Object.hasOwn(value, 'artistAliases')) {
      assertArtistAliasShape(value.artistAliases)
    }
  }
}

function assertFullConfigShape(input: unknown): asserts input is AppConfig {
  assertConfigPatchShape(input)
  for (const section of TOP_LEVEL_KEYS) {
    if (!Object.hasOwn(input as PlainRecord, section)) {
      throw new ConfigValidationError(`缺少${sectionLabel(section)}配置`)
    }
  }
}

function assertKnownKeys(value: PlainRecord, allowed: Set<string>, label: string) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new ConfigValidationError(`${label}包含未知配置项：${key}`)
    }
  }
}

function assertArtistAliasShape(value: unknown) {
  if (!isPlainRecord(value)) {
    throw new ConfigValidationError('艺人名替换映射必须是对象')
  }
  for (const [key, alias] of Object.entries(value)) {
    if (typeof alias !== 'string') {
      throw new ConfigValidationError(`艺人名替换映射「${key}」的值必须是字符串`)
    }
  }
}

function readString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new ConfigValidationError(`${label}必须是字符串`)
  return value
}

function readRequiredString(value: unknown, label: string): string {
  const stringValue = readString(value, label).trim()
  if (!stringValue) throw new ConfigValidationError(`${label}不能为空`)
  return stringValue
}

function readBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new ConfigValidationError(`${label}必须是布尔值`)
  return value
}

function readNumber(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ConfigValidationError(`${label}必须是数字`)
  }
  if (value < min || value > max) {
    throw new ConfigValidationError(`${label}必须在 ${min}-${max} 之间`)
  }
  return value
}

function readInteger(value: unknown, label: string, min: number, max: number): number {
  const numberValue = readNumber(value, label, min, max)
  if (!Number.isInteger(numberValue)) {
    throw new ConfigValidationError(`${label}必须是整数`)
  }
  return numberValue
}

function readEnum<T extends string>(value: unknown, allowed: Set<T>, label: string): T {
  if (typeof value !== 'string' || !allowed.has(value as T)) {
    throw new ConfigValidationError(`${label}不是有效选项`)
  }
  return value as T
}

function readArtistAliases(value: unknown): Record<string, string> {
  assertArtistAliasShape(value)
  return { ...(value as Record<string, string>) }
}

function readPathFormat(value: unknown): string {
  const pathFormat = readRequiredString(value, '存储路径格式')
  if (!PATH_FILE_VARIABLE_RE.test(pathFormat)) {
    throw new ConfigValidationError('存储路径格式必须包含 {title} 或 {track} 变量，避免不同歌曲写入同一文件')
  }
  return pathFormat
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/[\\/]+$/, '')
}

function get(source: PlainRecord, section: keyof AppConfig, field: string): unknown {
  const sectionValue = source[section]
  if (!isPlainRecord(sectionValue)) return undefined
  return sectionValue[field]
}

function coerceString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function coerceRequiredString(value: unknown, fallback: string): string {
  const next = coerceString(value, fallback).trim()
  return next || fallback
}

function coerceBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }
  return fallback
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

function coerceEnum<T extends string>(value: unknown, allowed: Set<T>, fallback: T): T {
  return typeof value === 'string' && allowed.has(value as T) ? value as T : fallback
}

function coerceArtistAliases(value: unknown): Record<string, string> {
  if (!isPlainRecord(value)) return {}
  const result: Record<string, string> = {}
  for (const [key, alias] of Object.entries(value)) {
    if (typeof alias === 'string') result[key] = alias
  }
  return result
}

function coercePathFormat(value: unknown, fallback: string): string {
  const pathFormat = coerceRequiredString(value, fallback)
  return PATH_FILE_VARIABLE_RE.test(pathFormat) ? pathFormat : fallback
}

function sectionLabel(section: string): string {
  switch (section) {
    case 'netease': return '网易云音乐'
    case 'plex': return 'Plex'
    case 'download': return '下载'
    case 'sync': return '同步'
    case 'other': return '高级'
    default: return section
  }
}
