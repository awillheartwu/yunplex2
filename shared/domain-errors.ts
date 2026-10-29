import { errorRecoveryMode } from './error-recovery'

export type DomainErrorCategory = 'netease' | 'plex' | 'media' | 'filesystem' | 'scheduler' | 'operation' | 'unknown'
export type DomainErrorSeverity = 'info' | 'warning' | 'error'

export type DomainErrorCode =
  | 'copyright_restricted'
  | 'authentication_failed'
  | 'plex_authentication_failed'
  | 'rate_limited'
  | 'netease_unavailable'
  | 'plex_unavailable'
  | 'plex_write_uncertain'
  | 'filesystem_failed'
  | 'media_identity_conflict'
  | 'scheduler_interrupted'
  | 'concurrent_operation'
  | 'failed_download'
  | 'failed_tags'
  | 'failed_plex_match'
  | 'failed_plex_insert'
  | 'source_unavailable'
  | 'source_missing'
  | 'invalid_audio'
  | 'unsupported_format'
  | 'validation_failed'
  | 'unknown_error'

export interface DomainErrorDefinition {
  code: DomainErrorCode
  category: DomainErrorCategory
  severity: DomainErrorSeverity
  /** Legacy response hint; execution policy and target admission are separate. */
  retryable: boolean
  label: string
  userMessage: string
}

export const DOMAIN_ERROR_CATALOG: Record<DomainErrorCode, Omit<DomainErrorDefinition, 'retryable'>> = {
  copyright_restricted: { code: 'copyright_restricted', category: 'netease', severity: 'info', label: '版权受限', userMessage: '网易云未提供可下载音源，本次已按版权限制跳过。' },
  authentication_failed: { code: 'authentication_failed', category: 'netease', severity: 'error', label: '认证失效', userMessage: '网易云登录状态已失效，请更新 Cookie 后重试。' },
  plex_authentication_failed: { code: 'plex_authentication_failed', category: 'plex', severity: 'error', label: 'Plex 认证失效', userMessage: 'Plex Token 无效或缺少音乐库权限，请修复后重试。' },
  rate_limited: { code: 'rate_limited', category: 'netease', severity: 'warning', label: '请求受限', userMessage: '服务请求过于频繁，系统稍后可以重试。' },
  netease_unavailable: { code: 'netease_unavailable', category: 'netease', severity: 'warning', label: '网易云连接异常', userMessage: '暂时无法连接网易云服务，请检查网络或代理后重试。' },
  plex_unavailable: { code: 'plex_unavailable', category: 'plex', severity: 'warning', label: 'Plex 不可用', userMessage: '暂时无法连接 Plex，请检查服务状态和网络后重试。' },
  plex_write_uncertain: { code: 'plex_write_uncertain', category: 'plex', severity: 'warning', label: 'Plex 写入结果待确认', userMessage: '上次 Plex 写入尚无完整读回证据，已停止后续写入。请核对实际歌单后重试；创建结果未知时需明确选择实际目标。' },
  filesystem_failed: { code: 'filesystem_failed', category: 'filesystem', severity: 'error', label: '文件写入失败', userMessage: '媒体目录无法读写，请检查挂载、权限和剩余空间。' },
  media_identity_conflict: { code: 'media_identity_conflict', category: 'media', severity: 'warning', label: '媒体身份冲突', userMessage: '候选媒体无法安全确认，需要手动选择或改为托管下载。' },
  scheduler_interrupted: { code: 'scheduler_interrupted', category: 'scheduler', severity: 'warning', label: '任务被中断', userMessage: '任务因服务重启或租约失效而中断，可以安全重试。' },
  concurrent_operation: { code: 'concurrent_operation', category: 'operation', severity: 'info', label: '任务占用中', userMessage: '已有互斥任务正在运行，请等待完成后重试。' },
  failed_download: { code: 'failed_download', category: 'netease', severity: 'error', label: '下载失败', userMessage: '歌曲下载失败，请重试或查看关联运行获取详情。' },
  failed_tags: { code: 'failed_tags', category: 'media', severity: 'error', label: '元数据失败', userMessage: '音频已下载，但元数据或标签写入未完成。' },
  failed_plex_match: { code: 'failed_plex_match', category: 'plex', severity: 'warning', label: 'Plex 匹配失败', userMessage: 'Plex 未在索引核对窗口内识别到媒体文件。' },
  failed_plex_insert: { code: 'failed_plex_insert', category: 'plex', severity: 'warning', label: 'Plex 更新失败', userMessage: 'Plex 已识别媒体，但未能完成歌单更新。' },
  source_unavailable: { code: 'source_unavailable', category: 'netease', severity: 'warning', label: '音源不可用', userMessage: '网易云未提供可用音源，可能是版权、地区或账号权限限制；本轮保留目标，不自动重试。' },
  source_missing: { code: 'source_missing', category: 'netease', severity: 'warning', label: '歌曲详情缺失', userMessage: '网易云未返回歌曲详情，可能是歌曲已下架；本轮保留 Plex 歌单，不自动删除。' },
  invalid_audio: { code: 'invalid_audio', category: 'media', severity: 'error', label: '音频文件损坏', userMessage: '网易云返回的音频文件未通过校验，未保存不完整文件；请稍后重试或忽略。' },
  unsupported_format: { code: 'unsupported_format', category: 'media', severity: 'warning', label: '音频格式不支持', userMessage: '网易云只返回 APE/WMA 等不支持的格式，未保存不完整音频。' },
  validation_failed: { code: 'validation_failed', category: 'operation', severity: 'info', label: '请求无效', userMessage: '请求内容无效，请检查输入后重试。' },
  unknown_error: { code: 'unknown_error', category: 'unknown', severity: 'error', label: '未知错误', userMessage: '操作失败，请查看日志获取诊断信息。' },
}

const LEGACY_CODES = new Set<DomainErrorCode>(Object.keys(DOMAIN_ERROR_CATALOG) as DomainErrorCode[])

export function isDomainErrorCode(value: unknown): value is DomainErrorCode {
  return typeof value === 'string' && LEGACY_CODES.has(value as DomainErrorCode)
}

export function getDomainErrorDefinition(code: string | null | undefined): DomainErrorDefinition {
  const definition = DOMAIN_ERROR_CATALOG[isDomainErrorCode(code) ? code : 'unknown_error']
  // Preserve the response contract for repairable filesystem failures.
  return { ...definition, retryable: errorRecoveryMode(definition.code) === 'retry' || definition.code === 'filesystem_failed' }
}

export function classifyDomainErrorCode(message: string | null | undefined, fallback: DomainErrorCode = 'unknown_error'): DomainErrorCode {
  const text = (message || '').toLowerCase()
  if (!text) return fallback
  if (/版权|copyright/.test(text)) return 'copyright_restricted'
  if (/cookie|登录状态|未登录|认证|unauthori[sz]ed|\b401\b/.test(text)) {
    return /plex/.test(text) || DOMAIN_ERROR_CATALOG[fallback].category === 'plex' ? 'plex_authentication_failed' : 'authentication_failed'
  }
  if (/限流|频繁|rate.?limit|too many requests|\b429\b/.test(text)) return 'rate_limited'
  if (/服务重启|租约|lease|interrupted|中断/.test(text)) return 'scheduler_interrupted'
  if (/已有.*(?:任务|同步)|正在运行|占用|concurrent|busy/.test(text)) return 'concurrent_operation'
  if (/无法获取目标歌曲信息|歌曲详情.*未返回|详情未返回|song_detail.*未返回/.test(text)) return 'source_missing'
  if (/未提供.*可用音源|音源状态\s*404|song_url_unavailable|试听音源|账号权限/.test(text)) return 'source_unavailable'
  if (/尚不支持|download_format_unsupported|不支持的音频格式/.test(text)) return 'unsupported_format'
  if (/文件头无效|音频文件无效|invalid_audio|下载的音频文件无效/.test(text)) return 'invalid_audio'
  if (/plex/.test(text) && /连接|不可用|超时|timeout|refused|unreachable|\b50[234]\b/.test(text)) return 'plex_unavailable'
  if (/网易云/.test(text) && /连接失败|请求超时|\b50[234]\b/.test(text)) return 'netease_unavailable'
  if (/eacces|eperm|enospc|enoent|只读|磁盘|空间|挂载|文件系统|(?:文件|目录|下载目录|媒体目录).{0,8}权限|写权限/.test(text)) return 'filesystem_failed'
  if (/身份冲突|关联失效|歧义|ambiguous|identity conflict|路径.*(?:冲突|归属)|命名.*冲突|受保护文件/.test(text)) return 'media_identity_conflict'
  if (/音频文件超过大小上限|download_too_large/.test(text)) return 'validation_failed'
  if (isTagFailureMessage(text)) return 'failed_tags'
  if (/连接失败|请求超时|etimedout|econn|enet|ehost|eai_again|und_err|fetch failed|socket|超时|timeout|\b50[234]\b/.test(text)) {
    return /plex/.test(text) || DOMAIN_ERROR_CATALOG[fallback].category === 'plex' ? 'plex_unavailable' : 'netease_unavailable'
  }
  if (/缺少|必须|无效|不存在|请提供|只支持|需要提供|格式错误|不符合|只有.*可以/.test(text)) return 'validation_failed'
  return fallback
}

export function resolveDomainErrorDefinition(code: string | null | undefined, message?: string | null): DomainErrorDefinition {
  const explicit = isDomainErrorCode(code) ? code : 'unknown_error'
  const messageCode = classifyDomainErrorCode(message, explicit)
  if (explicit === 'unknown_error' || explicit === 'failed_download') return getDomainErrorDefinition(messageCode)
  return getDomainErrorDefinition(explicit)
}

/** Legacy free-text diagnostics can still identify the stage independently of the cause. */
export function isTagFailureMessage(message: string | null | undefined): boolean {
  return /标签(?:写入|回读核验|清理)(?:失败| 超时)|(?:FLAC|MP3) (?:标签写入|元数据更新失败)|\b(?:failed to write|error writing) (?:audio )?(?:tags|metadata)\b|\b(?:tag|metadata) writ(?:e|ing) (?:failed|error)\b/i.test(message ?? '')
}
