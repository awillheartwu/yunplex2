import {
  appendSongIdentityEvent,
  markSongSourcesPendingAlignment,
  type AppendSongIdentityEventInput,
} from './match-management-store'

/**
 * Completes an identity-state transition inside the caller's database
 * transaction. Every durable identity change must be paired with an immutable
 * audit event and must invalidate alignment for every current source.
 */
export function recordIdentityTransition(
  input: AppendSongIdentityEventInput,
): Array<{ id: string; name: string }> {
  appendSongIdentityEvent(input)
  return markSongSourcesPendingAlignment(
    input.neteaseSongId,
    input.createdAt ?? new Date().toISOString(),
  )
}
