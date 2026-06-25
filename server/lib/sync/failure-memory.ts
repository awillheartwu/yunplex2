import type { SongStatus, SongTask } from '../job/types'
import { getSongLookup } from './song-lookup-store'

export type FailureMemoryPhase = Exclude<SongTask['phase'], 'done'>
export type FailureMemoryStatus = Extract<
  SongStatus,
  'failed_download' | 'failed_tags' | 'failed_plex_match' | 'failed_plex_insert'
>
export type FailureMemoryCause = 'library_visibility' | 'metadata_mismatch' | 'unknown'

export interface FailureMemoryEntry {
  count: number
  lastStatus?: FailureMemoryStatus
  lastPhase?: FailureMemoryPhase
  lastMessage?: string
  updatedAt?: string
  suspectedCause?: FailureMemoryCause
}

type RawFailureMemory = Record<string, number | FailureMemoryEntry>
export type FailureMemory = Record<number, FailureMemoryEntry>

function normalizeCount(value: unknown): number {
  const count = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(count) || count <= 0) return 0
  return Math.floor(count)
}

function isFailureMemoryEntry(value: unknown): value is FailureMemoryEntry {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseFailureMemory(raw: string | null | undefined): FailureMemory {
  if (!raw) return {}

  try {
    const parsed = JSON.parse(raw) as RawFailureMemory
    const memory: FailureMemory = {}

    for (const [songIdText, value] of Object.entries(parsed)) {
      const songId = Number(songIdText)
      if (!Number.isFinite(songId)) continue

      if (typeof value === 'number') {
        const count = normalizeCount(value)
        if (count > 0) memory[songId] = { count }
        continue
      }

      if (!isFailureMemoryEntry(value)) continue
      const count = normalizeCount(value.count)
      if (count <= 0) continue
      memory[songId] = {
        count,
        lastStatus: value.lastStatus,
        lastPhase: value.lastPhase,
        lastMessage: value.lastMessage,
        updatedAt: value.updatedAt,
        suspectedCause: value.suspectedCause,
      }
    }

    return memory
  } catch {
    return {}
  }
}

export function serializeFailureMemory(memory: FailureMemory): string | null {
  const entries = Object.entries(memory)
    .filter(([, value]) => normalizeCount(value.count) > 0)
    .sort(([left], [right]) => Number(left) - Number(right))

  if (entries.length === 0) return null

  return JSON.stringify(
    Object.fromEntries(entries.map(([songId, value]) => [
      songId,
      {
        count: normalizeCount(value.count),
        ...(value.lastStatus ? { lastStatus: value.lastStatus } : {}),
        ...(value.lastPhase ? { lastPhase: value.lastPhase } : {}),
        ...(value.lastMessage ? { lastMessage: value.lastMessage } : {}),
        ...(value.updatedAt ? { updatedAt: value.updatedAt } : {}),
        ...(value.suspectedCause ? { suspectedCause: value.suspectedCause } : {}),
      },
    ])),
  )
}

export function getFailureMemoryEntry(memory: FailureMemory, songId: number): FailureMemoryEntry | null {
  return memory[songId] ?? null
}

export function getFailureCount(memory: FailureMemory, songId: number): number {
  return getFailureMemoryEntry(memory, songId)?.count ?? 0
}

export function inferFailurePhase(songId: number, entry?: FailureMemoryEntry | null): FailureMemoryPhase {
  if (entry?.lastPhase) return entry.lastPhase

  const lookup = getSongLookup(songId)
  if (lookup?.file_path && !lookup.plex_rating_key) return 'plex_match'
  return 'download'
}

export function shouldSkipSongDueToFailure(
  memory: FailureMemory,
  songId: number,
  maxFailures: number,
): boolean {
  if (!maxFailures || maxFailures <= 0) return false

  const entry = getFailureMemoryEntry(memory, songId)
  if (!entry || entry.count < maxFailures) return false

  const phase = inferFailurePhase(songId, entry)
  return phase !== 'plex_match' && phase !== 'plex_insert'
}

export function recordFailure(
  memory: FailureMemory,
  songId: number,
  detail: {
    status: FailureMemoryStatus
    phase: FailureMemoryPhase
    message?: string
    suspectedCause?: FailureMemoryCause
  },
): FailureMemory {
  const current = getFailureMemoryEntry(memory, songId)
  return {
    ...memory,
    [songId]: {
      count: (current?.count ?? 0) + 1,
      lastStatus: detail.status,
      lastPhase: detail.phase,
      lastMessage: detail.message,
      updatedAt: new Date().toISOString(),
      suspectedCause: detail.suspectedCause ?? current?.suspectedCause ?? 'unknown',
    },
  }
}

export function removeFailures(memory: FailureMemory, songIds: number[]): FailureMemory {
  if (songIds.length === 0) return memory
  const next = { ...memory }
  for (const songId of songIds) {
    delete next[songId]
  }
  return next
}
