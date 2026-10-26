import type { DomainErrorCode, DomainErrorDefinition } from '../../shared/domain-errors'
import { classifyDomainErrorCode, getDomainErrorDefinition, isDomainErrorCode } from '../../shared/domain-errors'

import { errorSignals } from './error-signals'

export function classifyErrorCode(error: unknown, fallback: DomainErrorCode = 'unknown_error'): DomainErrorCode {
  const { chain, code, message, status, provider } = errorSignals(error)
  const explicit = chain.find(item => isDomainErrorCode(item.code))?.code
  if (isDomainErrorCode(explicit)) return explicit
  const plex = provider === 'plex' || /plex/.test(message) || getDomainErrorDefinition(fallback).category === 'plex'
  if (/ENOSPC|EACCES|EPERM|EROFS/.test(code)) return 'filesystem_failed'
  if (status === 401 || /AUTHENTICATION_FAILED/.test(code)) return plex ? 'plex_authentication_failed' : 'authentication_failed'
  if (status === 429) return 'rate_limited'
  if (/COPYRIGHT_RESTRICTED/i.test(code)) return 'copyright_restricted'
  if (/MEDIA_IDENTITY_CONFLICT/.test(code)) return 'media_identity_conflict'
  if (/SONG_URL_UNAVAILABLE/.test(code)) return 'source_unavailable'
  if (/DOWNLOAD_FORMAT_UNSUPPORTED/.test(code)) return 'unsupported_format'
  if (/DOWNLOAD_INVALID_AUDIO|INVALID_AUDIO/.test(code)) return 'invalid_audio'
  if (status >= 500 || /NETEASE_REQUEST_FAILED|NETEASE_INITIALIZATION_FAILED|ETIMEDOUT|ECONN|ENET|EHOST|EAI_AGAIN|UND_ERR/.test(code)) {
    return plex ? 'plex_unavailable' : 'netease_unavailable'
  }
  const classified = classifyDomainErrorCode(message, fallback)
  if (plex && classified === 'authentication_failed') return 'plex_authentication_failed'
  if (plex && classified === 'netease_unavailable') return 'plex_unavailable'
  return classified
}

export interface StructuredDomainError extends DomainErrorDefinition {
  diagnostic: string | null
}

export function sanitizeDiagnosticMessage(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const raw = value instanceof Error ? value.message : String(value)
  if (!raw.trim()) return null
  return raw
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/(authorization\s*[:=]\s*)(?:bearer|basic)\s+[^\s,;"']+/gi, '$1[REDACTED]')
    .replace(/((?:set-cookie|cookie)\s*[:=]\s*)[\w-]+=[^\s;,"']+(?:;\s*[\w-]+=[^\s;,"']+)*/gi, '$1[REDACTED]')
    .replace(/(["']?(?:cookie|token|authorization|auth|password|passwd|api[_-]?key|secret|music_[ua]|__csrf|_ntes_nuid|_ntes_nnid)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;&"'<>}]+)/gi, '$1[REDACTED]')
    .slice(0, 1000)
}

export function describeDomainError(error: unknown, fallback: DomainErrorCode = 'unknown_error'): StructuredDomainError {
  const diagnostic = sanitizeDiagnosticMessage(error)
  const code = classifyErrorCode(error, fallback)
  return { ...getDomainErrorDefinition(code), diagnostic }
}
