export type DomainErrorCategory = 'netease' | 'plex' | 'media' | 'filesystem' | 'scheduler' | 'operation' | 'unknown'
export type DomainErrorSeverity = 'info' | 'warning' | 'error'

export type DomainErrorCode =
  | 'copyright_restricted'
  | 'authentication_failed'
  | 'rate_limited'
  | 'plex_unavailable'
  | 'filesystem_failed'
  | 'media_identity_conflict'
  | 'scheduler_interrupted'
  | 'concurrent_operation'
  | 'failed_download'
  | 'failed_tags'
  | 'failed_plex_match'
  | 'failed_plex_insert'
  | 'ignored_failure'
  | 'validation_failed'
  | 'unknown_error'

export interface DomainErrorDefinition {
  code: DomainErrorCode
  category: DomainErrorCategory
  severity: DomainErrorSeverity
  retryable: boolean
  label: string
  userMessage: string
}

export const DOMAIN_ERROR_CATALOG: Record<DomainErrorCode, DomainErrorDefinition> = {
  copyright_restricted: { code: 'copyright_restricted', category: 'netease', severity: 'info', retryable: false, label: '版权受限', userMessage: '网易云未提供可下载音源，本次已按版权限制跳过。' },
  authentication_failed: { code: 'authentication_failed', category: 'netease', severity: 'error', retryable: false, label: '认证失效', userMessage: '网易云登录状态已失效，请更新 Cookie 后重试。' },
  rate_limited: { code: 'rate_limited', category: 'netease', severity: 'warning', retryable: true, label: '请求受限', userMessage: '服务请求过于频繁，系统稍后可以重试。' },
  plex_unavailable: { code: 'plex_unavailable', category: 'plex', severity: 'warning', retryable: true, label: 'Plex 不可用', userMessage: '暂时无法连接 Plex，请检查服务状态和网络后重试。' },
  filesystem_failed: { code: 'filesystem_failed', category: 'filesystem', severity: 'error', retryable: true, label: '文件写入失败', userMessage: '媒体目录无法读写，请检查挂载、权限和剩余空间。' },
  media_identity_conflict: { code: 'media_identity_conflict', category: 'media', severity: 'warning', retryable: false, label: '媒体身份冲突', userMessage: '候选媒体无法安全确认，需要手动选择或改为托管下载。' },
  scheduler_interrupted: { code: 'scheduler_interrupted', category: 'scheduler', severity: 'warning', retryable: true, label: '任务被中断', userMessage: '任务因服务重启或租约失效而中断，可以安全重试。' },
  concurrent_operation: { code: 'concurrent_operation', category: 'operation', severity: 'info', retryable: true, label: '任务占用中', userMessage: '已有互斥任务正在运行，请等待完成后重试。' },
  failed_download: { code: 'failed_download', category: 'netease', severity: 'error', retryable: true, label: '下载失败', userMessage: '歌曲下载失败，请重试或查看关联运行获取详情。' },
  failed_tags: { code: 'failed_tags', category: 'media', severity: 'error', retryable: true, label: '元数据失败', userMessage: '音频已下载，但元数据或标签写入未完成。' },
  failed_plex_match: { code: 'failed_plex_match', category: 'plex', severity: 'warning', retryable: true, label: 'Plex 匹配失败', userMessage: 'Plex 未在重试窗口内识别到媒体文件。' },
  failed_plex_insert: { code: 'failed_plex_insert', category: 'plex', severity: 'warning', retryable: true, label: 'Plex 更新失败', userMessage: 'Plex 已识别媒体，但未能完成歌单更新。' },
  ignored_failure: { code: 'ignored_failure', category: 'operation', severity: 'info', retryable: false, label: '连续失败', userMessage: '连续失败达到阈值，系统已暂停自动重试。' },
  validation_failed: { code: 'validation_failed', category: 'operation', severity: 'info', retryable: false, label: '请求无效', userMessage: '请求内容无效，请检查输入后重试。' },
  unknown_error: { code: 'unknown_error', category: 'unknown', severity: 'error', retryable: false, label: '未知错误', userMessage: '操作失败，请查看日志获取诊断信息。' },
}

const LEGACY_CODES = new Set<DomainErrorCode>(Object.keys(DOMAIN_ERROR_CATALOG) as DomainErrorCode[])

export function isDomainErrorCode(value: unknown): value is DomainErrorCode {
  return typeof value === 'string' && LEGACY_CODES.has(value as DomainErrorCode)
}

export function getDomainErrorDefinition(code: string | null | undefined): DomainErrorDefinition {
  return DOMAIN_ERROR_CATALOG[isDomainErrorCode(code) ? code : 'unknown_error']
}

export function classifyDomainErrorCode(message: string | null | undefined, fallback: DomainErrorCode = 'unknown_error'): DomainErrorCode {
  const text = (message || '').toLowerCase()
  if (!text) return fallback
  if (/版权|copyright|无法获取歌曲|下载链接/.test(text)) return 'copyright_restricted'
  if (/cookie|登录状态|未登录|认证|unauthori[sz]ed|forbidden|\b401\b|\b403\b/.test(text)) return 'authentication_failed'
  if (/限流|频繁|rate.?limit|too many requests|\b429\b/.test(text)) return 'rate_limited'
  if (/服务重启|租约|lease|interrupted|中断/.test(text)) return 'scheduler_interrupted'
  if (/已有.*(?:任务|同步)|正在运行|占用|concurrent|busy/.test(text)) return 'concurrent_operation'
  if (/缺少|必须|无效|不存在|请提供|只支持|需要提供|格式错误|不符合|只有.*可以/.test(text)) return 'validation_failed'
  if (/plex/.test(text) && /连接|不可用|超时|timeout|refused|unreachable|\b50[234]\b/.test(text)) return 'plex_unavailable'
  if (/eacces|eperm|enospc|enoent|只读|权限|磁盘|空间|挂载|文件系统/.test(text)) return 'filesystem_failed'
  if (/身份冲突|关联失效|歧义|ambiguous|identity conflict/.test(text)) return 'media_identity_conflict'
  if (/标签|metadata|tag/.test(text)) return 'failed_tags'
  return fallback
}

export function resolveDomainErrorDefinition(code: string | null | undefined, message?: string | null): DomainErrorDefinition {
  const fallback = isDomainErrorCode(code) ? code : 'unknown_error'
  return getDomainErrorDefinition(classifyDomainErrorCode(message, fallback))
}
