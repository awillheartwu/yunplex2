import type { DomainErrorCode, DomainErrorCategory, DomainErrorSeverity } from '../../shared/domain-errors'
import { getDomainErrorDefinition } from '../../shared/domain-errors'
import { describeDomainError, sanitizeDiagnosticMessage } from './domain-error'

export interface ApiResponse<T = unknown> {
  code: number
  msg: string
  data: T
  error?: ApiErrorDetail
}

export interface ApiErrorDetail {
  code: DomainErrorCode
  category: DomainErrorCategory
  severity: DomainErrorSeverity
  retryable: boolean
}

export function success<T>(data: T, msg = 'ok'): ApiResponse<T> {
  return { code: 0, msg, data }
}

export function fail(error: unknown, code = 1, fallback?: DomainErrorCode): ApiResponse<null> {
  const selectedFallback = fallback ?? 'unknown_error'
  const detail = describeDomainError(error, selectedFallback)
  return {
    code,
    msg: detail.code === 'validation_failed' ? detail.diagnostic || detail.userMessage : detail.userMessage,
    data: null,
    error: {
      code: detail.code,
      category: detail.category,
      severity: detail.severity,
      retryable: detail.retryable,
    },
  }
}

/**
 * Keeps an already user-facing message (for example a connection-test finding) while still
 * attaching the structured domain policy. Use this when the caller knows the domain code and
 * the message must not be replaced by the catalog's generic copy.
 */
export function failDomain(code: DomainErrorCode, message?: string, apiCode = 1): ApiResponse<null> {
  const definition = getDomainErrorDefinition(code)
  const trimmed = sanitizeDiagnosticMessage(message)?.trim()
  return {
    code: apiCode,
    msg: trimmed || definition.userMessage,
    data: null,
    error: {
      code: definition.code,
      category: definition.category,
      severity: definition.severity,
      retryable: definition.retryable,
    },
  }
}
