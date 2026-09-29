import { createHash } from 'node:crypto'
import { DEFAULT_INITIALIZATION_MATCHING, type InitializationMatchingConfig, type MusicBrainzMatchingEvidence } from '../../../shared/initialization-matching'
import type { AppConfig } from '../config/types'

/** Canonical serialization makes equivalent configs independent of object key order. */
export function matchingFingerprint(value: unknown): string {
  const canonical = (input: unknown): unknown => Array.isArray(input) ? input.map(canonical)
    : input && typeof input === 'object' ? Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => [key, canonical(val)])) : input
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}
export interface MatchingPolicySnapshot {
  config: InitializationMatchingConfig
  legacyAliases: Record<string, string>
  musicBrainz?: MusicBrainzMatchingEvidence
}
export function captureMatchingPolicy(config: AppConfig): MatchingPolicySnapshot {
  const matching = structuredClone(config.initializationMatching ?? DEFAULT_INITIALIZATION_MATCHING)
  // Keep legacy inputs too: a same-data preview may switch enhancement off.
  // The enhanced engine itself never consumes these download aliases.
  return { config: matching, legacyAliases: structuredClone(config.other.artistAliases) }
}
