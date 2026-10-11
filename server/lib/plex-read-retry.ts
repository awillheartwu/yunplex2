interface PlexReader {
  query(path: string): Promise<Record<string, unknown>>
}

const RETRYABLE_CONNECTION_ERRORS = new Set(['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ESOCKETTIMEDOUT'])

/** Retry only reads, so an uncertain Plex write is never replayed. */
export async function queryPlexRead(reader: PlexReader, path: string): Promise<Record<string, unknown>> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await reader.query(path)
    } catch (error) {
      const code = (error as { code?: string } | null)?.code
      if (attempt >= 2 || !code || !RETRYABLE_CONNECTION_ERRORS.has(code)) throw error
      // Yield before retrying: a stale pooled socket may have closed while
      // synchronous local-media inspection held the event loop.
      await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)))
    }
  }
}
