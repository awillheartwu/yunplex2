import type { DomainErrorCode, DomainErrorDefinition } from '../../shared/domain-errors'
import { classifyDomainErrorCode, getDomainErrorDefinition } from '../../shared/domain-errors'

export interface StructuredDomainError extends DomainErrorDefinition {
  diagnostic: string | null
}

export function sanitizeDiagnosticMessage(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const raw = value instanceof Error ? value.message : String(value)
  if (!raw.trim()) return null
  return raw
    .replace(/((?:cookie|token|authorization)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/([?&](?:token|auth|cookie)=)[^&\s]+/gi, '$1[REDACTED]')
    .slice(0, 1000)
}

export function describeDomainError(error: unknown, fallback: DomainErrorCode = 'unknown_error'): StructuredDomainError {
  const diagnostic = sanitizeDiagnosticMessage(error)
  const code = classifyDomainErrorCode(diagnostic, fallback)
  return { ...getDomainErrorDefinition(code), diagnostic }
}
