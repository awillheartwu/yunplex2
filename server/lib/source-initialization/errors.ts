import { fail } from '../response'

export class InitializationConflictError extends Error {}

/** Keep actionable draft conflicts in the existing response envelope. */
export function initializationFailure(error: unknown) {
  return error instanceof InitializationConflictError
    ? fail(error, 409, 'validation_failed')
    : fail(error)
}
