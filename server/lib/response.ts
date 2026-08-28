import type { DomainErrorCode, DomainErrorCategory, DomainErrorSeverity } from '../../shared/domain-errors'
import { describeDomainError } from './domain-error'

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
  const rawMessage = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return {
    code,
    msg: detail.code === 'validation_failed' ? rawMessage || detail.userMessage : detail.userMessage,
    data: null,
    error: {
      code: detail.code,
      category: detail.category,
      severity: detail.severity,
      retryable: detail.retryable,
    },
  }
}
