export interface SystemDiagnosticInfo {
  version?: string
  platform?: string
  nodeVersion?: string
  docker?: boolean | string
}

export interface SystemDiagnosticStats {
  cpu?: number
  mem?: {
    rss?: number
    heapUsed?: number
    heapTotal?: number
    external?: number
  }
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
    memoryMb: {
      rss: number | null
      heapUsed: number | null
      heapTotal: number | null
      external: number | null
    }
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
        rss: finiteNumber(stats.mem?.rss),
        heapUsed: finiteNumber(stats.mem?.heapUsed),
        heapTotal: finiteNumber(stats.mem?.heapTotal),
        external: finiteNumber(stats.mem?.external),
      },
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
