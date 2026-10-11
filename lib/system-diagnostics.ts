import { memoryBytes, type SystemMemoryInput } from './system-memory'
import { MEBIBYTE, type MemorySamplingContext, type ProcessMemoryBytes } from '../shared/system-memory'

export interface SystemDiagnosticInfo {
  version?: string
  platform?: string
  nodeVersion?: string
  docker?: boolean | string
}

export interface SystemDiagnosticStats extends SystemMemoryInput {
  cpu?: number
  uptime?: number
  pid?: number
  dbSize?: number
  dbStats?: Record<string, number>
  plexOk?: boolean
  neteaseOk?: boolean
  dirWritable?: boolean
  dependencyCheckedAt?: number
  dependencyCacheTtlMs?: number
  timestamp?: number
}

export interface SystemDiagnosticReport {
  generatedAt: string
  app: {
    version: string
    platform: string
    nodeVersion: string
    docker: boolean
  }
  process: {
    pid: number | null
    uptimeSeconds: number
  }
  resources: {
    cpuPercent: number | null
    /** Legacy field name retained; memoryUnit specifies the actual binary unit. */
    memoryMb: Record<keyof ProcessMemoryBytes, number | null>
    memoryUnit: 'MiB'
    memoryBytes: Record<keyof ProcessMemoryBytes, number | null>
    memoryContext: MemorySamplingContext | null
    dbSizeMb: number | null
  }
  health: {
    plexOk: boolean
    neteaseOk: boolean
    dirWritable: boolean
    dependencyCheckedAt: string | null
    dependencyCacheTtlMs: number | null
  }
  tables: Record<string, number>
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function booleanValue(value: unknown): boolean {
  return value === true
}

function isoTime(value: unknown): string | null {
  const timestamp = finiteNumber(value)
  if (timestamp === null) return null
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function memoryMiB(stats: SystemDiagnosticStats, key: keyof ProcessMemoryBytes): number | null {
  const bytes = memoryBytes(stats, key)
  return bytes === null ? null : bytes / MEBIBYTE
}

function memoryContext(context?: MemorySamplingContext): MemorySamplingContext | null {
  if (!context) return null
  return {
    mode: context.mode,
    rssScope: context.rssScope,
    detailsScope: context.detailsScope,
    isMainThread: context.isMainThread,
    threadId: context.threadId,
  }
}

export function buildSystemDiagnosticReport(input: {
  info?: SystemDiagnosticInfo | null
  stats?: SystemDiagnosticStats | null
  generatedAt?: Date
}): SystemDiagnosticReport {
  const info = input.info || {}
  const stats = input.stats || {}
  return {
    generatedAt: (input.generatedAt || new Date()).toISOString(),
    app: {
      version: String(info.version || ''),
      platform: String(info.platform || ''),
      nodeVersion: String(info.nodeVersion || ''),
      docker: info.docker === true || info.docker === 'true',
    },
    process: {
      pid: finiteNumber(stats.pid),
      uptimeSeconds: finiteNumber(stats.uptime) || 0,
    },
    resources: {
      cpuPercent: finiteNumber(stats.cpu),
      memoryMb: {
        rss: memoryMiB(stats, 'rss'),
        heapUsed: memoryMiB(stats, 'heapUsed'),
        heapTotal: memoryMiB(stats, 'heapTotal'),
        external: memoryMiB(stats, 'external'),
        arrayBuffers: memoryMiB(stats, 'arrayBuffers'),
      },
      memoryUnit: 'MiB',
      memoryBytes: {
        rss: finiteNumber(stats.memory?.rss),
        heapUsed: finiteNumber(stats.memory?.heapUsed),
        heapTotal: finiteNumber(stats.memory?.heapTotal),
        external: finiteNumber(stats.memory?.external),
        arrayBuffers: finiteNumber(stats.memory?.arrayBuffers),
      },
      memoryContext: memoryContext(stats.memoryContext),
      dbSizeMb: finiteNumber(stats.dbSize),
    },
    health: {
      plexOk: booleanValue(stats.plexOk),
      neteaseOk: booleanValue(stats.neteaseOk),
      dirWritable: booleanValue(stats.dirWritable),
      dependencyCheckedAt: isoTime(stats.dependencyCheckedAt),
      dependencyCacheTtlMs: finiteNumber(stats.dependencyCacheTtlMs),
    },
    tables: Object.fromEntries(
      Object.entries(stats.dbStats || {})
        .filter(([, value]) => typeof value === 'number' && Number.isFinite(value)),
    ),
  }
}
