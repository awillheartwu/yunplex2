import { success } from '../../lib/response'
import { getDb } from '../../lib/db'
import { readConfig, getDataDir } from '../../lib/config/store'
import { checkCookie } from '../../lib/netease'
import os from 'node:os'
import { statSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// Track CPU usage across requests
let lastCpuUsage = process.cpuUsage()
let lastCpuTime = Date.now()

function getCpuPercent(): number {
  const now = Date.now()
  const elapsed = now - lastCpuTime
  if (elapsed < 100) return 0 // too soon

  const usage = process.cpuUsage(lastCpuUsage)
  lastCpuUsage = process.cpuUsage()
  lastCpuTime = now

  // usage is in microseconds, elapsed is in milliseconds
  // CPU % = (user + system) / (elapsed * 1000) * 100
  // But that's % of ONE core. Divide by number of cores for normalized %
  const totalUsageUs = usage.user + usage.system
  const elapsedUs = elapsed * 1000
  const coreCount = os.cpus().length
  return Math.round((totalUsageUs / elapsedUs / coreCount) * 10000) / 100
}

function getMemUsage() {
  const m = process.memoryUsage()
  return {
    rss: Math.round(m.rss / 1024 / 1024),
    heapUsed: Math.round(m.heapUsed / 1024 / 1024),
    heapTotal: Math.round(m.heapTotal / 1024 / 1024),
    external: Math.round(m.external / 1024 / 1024),
  }
}

function getDbStats() {
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

function getDbFileSize() {
  try {
    const dbPath = resolve(getDataDir(), 'data.db')
    if (existsSync(dbPath)) {
      return Math.round(statSync(dbPath).size / 1024 / 1024 * 10) / 10
    }
  } catch { /* ignore */ }
  return 0
}

async function checkNetease() {
  try {
    const cfg = readConfig()
    if (!cfg.netease.cookie) return false
    const res = await checkCookie(cfg.netease.cookie)
    return res.valid
  } catch { return false }
}

async function checkPlex() {
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

export default defineEventHandler(async () => {
  const [mem, dbStats, dbSize, plexOk, neteaseOk] = await Promise.all([
    Promise.resolve(getMemUsage()),
    Promise.resolve(getDbStats()),
    Promise.resolve(getDbFileSize()),
    checkPlex(),
    checkNetease(),
  ])

  return success({
    cpu: getCpuPercent(),
    mem,
    uptime: Math.round(process.uptime()),
    pid: process.pid,
    dbSize,
    dbStats,
    plexOk,
    neteaseOk,
    timestamp: Date.now(),
  })
})
