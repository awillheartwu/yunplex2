export const MEBIBYTE = 1024 * 1024

/** Node's memoryUsage() values, in bytes. RSS is process-wide; the rest are thread-local. */
export interface ProcessMemoryBytes {
  rss: number
  heapUsed: number
  heapTotal: number
  external: number
  arrayBuffers: number
}

/** Existing stats API compatibility fields, rounded to whole MiB. */
export type RoundedMemoryMiB = Record<keyof ProcessMemoryBytes, number>

export interface MemorySamplingContext {
  mode: 'development' | 'production' | 'unknown'
  rssScope: 'process'
  detailsScope: 'thread'
  isMainThread: boolean
  threadId: number
}

export interface ProcessMemorySample {
  memory: ProcessMemoryBytes
  memoryContext: MemorySamplingContext
}
