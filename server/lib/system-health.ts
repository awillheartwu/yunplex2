import { statSync, existsSync, accessSync, constants } from 'node:fs'
import { resolve } from 'node:path'
import { checkCookie } from './netease'
import { readConfig, getDataDir } from './config/store'
import { getDb } from './db'
import os from 'node:os'

let lastCpuUsage = process.cpuUsage()
let lastCpuTime = Date.now()

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
  dbStats: Record<string, number>
  plexOk: boolean
  neteaseOk: boolean
  dirWritable: boolean
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

export function getDbStats() {
  try {
    const db = getDb()
    const tables: Record<string, number> = {}
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]
    for (const r of rows) {
      const cnt = (db.prepare(`SELECT COUNT(*) as c FROM "${r.name}"`).get() as { c: number }).c
      tables[r.name] = cnt
    }
    return tables
  } catch {
    return {}
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
    const t = setTimeout(() => controller.abort(), 3000)
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(t)
    return res.ok
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

export async function getSystemHealthSnapshot(): Promise<SystemHealthSnapshot> {
  const [mem, dbStats, dbSize, plexOk, neteaseOk, dirWritable] = await Promise.all([
    Promise.resolve(getMemUsage()),
    Promise.resolve(getDbStats()),
    Promise.resolve(getDbFileSize()),
    checkPlexHealth(),
    checkNeteaseHealth(),
    Promise.resolve(checkDownloadDirWritable()),
  ])

  return {
    cpu: getCpuPercent(),
    mem,
    uptime: Math.round(process.uptime()),
    pid: process.pid,
    dbSize,
    dbStats,
    plexOk,
    neteaseOk,
    dirWritable,
    timestamp: Date.now(),
  }
}
