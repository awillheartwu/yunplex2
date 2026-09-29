import type { DomainErrorCode } from '../../../shared/domain-errors'

/**
 * Connection-test failures carry an explicit domain code so the API layer can return the exact
 * finding instead of letting message classification fall back to the generic unknown copy.
 * Messages built here are user-facing and must never embed credentials.
 */
export class ConnectionTestError extends Error {
  constructor(readonly code: DomainErrorCode, message: string) {
    super(message)
    this.name = 'ConnectionTestError'
  }
}
