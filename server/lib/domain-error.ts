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
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/(authorization\s*[:=]\s*)(?:bearer|basic)\s+[^\s,;"']+/gi, '$1[REDACTED]')
    .replace(/((?:set-cookie|cookie)\s*[:=]\s*)[\w-]+=[^\s;,"']+(?:;\s*[\w-]+=[^\s;,"']+)*/gi, '$1[REDACTED]')
    .replace(/(["']?(?:cookie|token|authorization|auth|password|passwd|api[_-]?key|secret|music_[ua]|__csrf|_ntes_nuid|_ntes_nnid)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;&"'<>}]+)/gi, '$1[REDACTED]')
    .slice(0, 1000)
}

export function describeDomainError(error: unknown, fallback: DomainErrorCode = 'unknown_error'): StructuredDomainError {
  const diagnostic = sanitizeDiagnosticMessage(error)
  const code = classifyDomainErrorCode(diagnostic, fallback)
  return { ...getDomainErrorDefinition(code), diagnostic }
}
