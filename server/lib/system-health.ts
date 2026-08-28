import { statSync, existsSync, accessSync, constants } from 'node:fs'
import { resolve } from 'node:path'
import { checkCookie } from './netease'
import { readConfig, getDataDir } from './config/store'
import os from 'node:os'
import { getSyncWorker } from './sync/instance'
import type { SourceSchedulerStatus } from './sync/worker'

export const DEPENDENCY_HEALTH_TTL_MS = 60_000

let lastCpuUsage = process.cpuUsage()
let lastCpuTime = Date.now()
let dependencyHealthCache: DependencyHealthSnapshot | null = null

type HealthCheckers = {
  plex: () => Promise<boolean>
  netease: () => Promise<boolean>
  dirWritable: () => boolean
}

function defaultHealthCheckers(): HealthCheckers {
  return {
    plex: checkPlexHealth,
    netease: checkNeteaseHealth,
    dirWritable: checkDownloadDirWritable,
  }
}

let healthCheckers = defaultHealthCheckers()

export interface DependencyHealthSnapshot {
  plexOk: boolean
  neteaseOk: boolean
  dirWritable: boolean
  dependencyCheckedAt: number
  dependencyCacheExpiresAt: number
  dependencyCacheTtlMs: number
}

export interface DependencyHealthOptions {
  force?: boolean
  now?: number
}

export interface SystemHealthSnapshot {
  cpu: number
  mem: {
    rss: number
    heapUsed: number
    heapTotal: number
    external: number
  }
  uptime: number
  pid: number
  dbSize: number
  plexOk: boolean
  neteaseOk: boolean
  dirWritable: boolean
  dependencyCheckedAt: number
  dependencyCacheExpiresAt: number
  dependencyCacheTtlMs: number
  scheduler: SourceSchedulerStatus | null
  timestamp: number
}

export function getCpuPercent(): number {
  const now = Date.now()
  const elapsed = now - lastCpuTime
  if (elapsed < 100) return 0

  const usage = process.cpuUsage(lastCpuUsage)
  lastCpuUsage = process.cpuUsage()
  lastCpuTime = now

  const totalUsageUs = usage.user + usage.system
  const elapsedUs = elapsed * 1000
  const coreCount = os.cpus().length
  return Math.round((totalUsageUs / elapsedUs / coreCount) * 10000) / 100
}

export function getMemUsage() {
  const m = process.memoryUsage()
  return {
    rss: Math.round(m.rss / 1024 / 1024),
    heapUsed: Math.round(m.heapUsed / 1024 / 1024),
    heapTotal: Math.round(m.heapTotal / 1024 / 1024),
    external: Math.round(m.external / 1024 / 1024),
  }
}

export function getDbFileSize() {
  try {
    const dbPath = resolve(getDataDir(), 'data.db')
    if (existsSync(dbPath)) {
      return Math.round(statSync(dbPath).size / 1024 / 1024 * 10) / 10
    }
  } catch { /* ignore */ }
  return 0
}

export async function checkNeteaseHealth() {
  try {
    const cfg = readConfig()
    if (!cfg.netease.cookie) return false
    const res = await checkCookie(cfg.netease.cookie)
    return res.valid
  } catch {
    return false
  }
}

export async function checkPlexHealth() {
  try {
    const cfg = readConfig()
    const url = `http://${cfg.plex.server}:${cfg.plex.port}/identity?X-Plex-Token=${cfg.plex.token}`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)
    try {
      const res = await fetch(url, { signal: controller.signal })
      return res.ok
    } finally {
      clearTimeout(timeout)
    }
  } catch {
    return false
  }
}

export function checkDownloadDirWritable() {
  try {
    const cfg = readConfig()
    if (!cfg.download.dir) return false
    accessSync(cfg.download.dir, constants.W_OK)
    return true
  } catch {
    return false
  }
}

export async function getDependencyHealthSnapshot(options: DependencyHealthOptions = {}): Promise<DependencyHealthSnapshot> {
  const now = options.now ?? Date.now()
  if (!options.force && dependencyHealthCache && dependencyHealthCache.dependencyCacheExpiresAt > now) {
    return dependencyHealthCache
  }

  const [plexOk, neteaseOk, dirWritable] = await Promise.all([
    healthCheckers.plex(),
    healthCheckers.netease(),
    Promise.resolve(healthCheckers.dirWritable()),
  ])
  dependencyHealthCache = {
    plexOk,
    neteaseOk,
    dirWritable,
    dependencyCheckedAt: now,
    dependencyCacheExpiresAt: now + DEPENDENCY_HEALTH_TTL_MS,
    dependencyCacheTtlMs: DEPENDENCY_HEALTH_TTL_MS,
  }
  return dependencyHealthCache
}

export function resetSystemHealthCacheForTest() {
  dependencyHealthCache = null
  healthCheckers = defaultHealthCheckers()
}

export function setSystemHealthCheckersForTest(checkers: Partial<HealthCheckers>) {
  dependencyHealthCache = null
  healthCheckers = { ...defaultHealthCheckers(), ...checkers }
}

export async function getSystemHealthSnapshot(): Promise<SystemHealthSnapshot> {
  const [mem, dbSize, dependencyHealth] = await Promise.all([
    Promise.resolve(getMemUsage()),
    Promise.resolve(getDbFileSize()),
    getDependencyHealthSnapshot(),
  ])

  return {
    cpu: getCpuPercent(),
    mem,
    uptime: Math.round(process.uptime()),
    pid: process.pid,
    dbSize,
    ...dependencyHealth,
    scheduler: getSyncWorker()?.getStatus() ?? null,
    timestamp: Date.now(),
  }
}
